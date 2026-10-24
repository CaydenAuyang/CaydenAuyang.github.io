// extract.swift: one photo in, everything the figure build needs out.
//
//   extract <photo.heic> <outdir> [--max 1600]
//
// Writes to outdir (which must be outside the repo; build.mjs checks this):
//   color.rgba, color.png        the photo with its orientation applied, long side <= --max
//   matte.u8, matte.png          person matte, same size as color. From the photo's own Portrait
//                                matte when it has one, otherwise Apple Vision person segmentation
//                                (accurate quality)
//   hair.u8, skin.u8             semantic mattes when the photo carries them
//   depth.f32                    the photo's own disparity/depth when present (Float32, same size)
//   meta.json                    sizes, orientation, which aux data was found, face landmarks and
//                                face yaw from Vision, body pose joints from Vision
//
// Build: swiftc -O extract.swift -o extract (build.mjs does this for you).

import AVFoundation
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
var maxSide = 1600
if let i = args.firstIndex(of: "--max"), i + 1 < args.count {
  maxSide = Int(args[i + 1]) ?? 1600
  args.removeSubrange(i...(i + 1))
}
guard args.count >= 2 else { fail("usage: extract <photo> <outdir> [--max 1600]") }
let inURL = URL(fileURLWithPath: args[0])
let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

guard let src = CGImageSourceCreateWithURL(inURL as CFURL, nil) else { fail("cannot open \(inURL.path)") }
let props = (CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]) ?? [:]
let orientationRaw = (props[kCGImagePropertyOrientation] as? UInt32) ?? 1
let orientation = CGImagePropertyOrientation(rawValue: orientationRaw) ?? .up
let fullW = (props[kCGImagePropertyPixelWidth] as? Int) ?? 0
let fullH = (props[kCGImagePropertyPixelHeight] as? Int) ?? 0
let exif = (props[kCGImagePropertyExifDictionary] as? [CFString: Any]) ?? [:]

// Primary image, oriented and downscaled by ImageIO.
let thumbOpts: [CFString: Any] = [
  kCGImageSourceCreateThumbnailFromImageAlways: true,
  kCGImageSourceCreateThumbnailWithTransform: true,
  kCGImageSourceThumbnailMaxPixelSize: maxSide,
  kCGImageSourceShouldCacheImmediately: true,
]
guard let thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, thumbOpts as CFDictionary) else { fail("cannot decode image") }
let W = thumb.width
let H = thumb.height

func rgbaBytes(_ img: CGImage, _ w: Int, _ h: Int) -> [UInt8] {
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let cs = CGColorSpace(name: CGColorSpace.sRGB)!
  buf.withUnsafeMutableBytes { p in
    let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  }
  return buf
}

func writePNG(_ bytes: [UInt8], _ w: Int, _ h: Int, gray: Bool, to url: URL) {
  let cs = gray ? CGColorSpaceCreateDeviceGray() : CGColorSpace(name: CGColorSpace.sRGB)!
  let info: UInt32 = gray ? CGImageAlphaInfo.none.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let data = Data(bytes) as CFData
  guard let prov = CGDataProvider(data: data),
        let img = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: gray ? 8 : 32, bytesPerRow: gray ? w : w * 4,
                          space: cs, bitmapInfo: CGBitmapInfo(rawValue: info), provider: prov, decode: nil, shouldInterpolate: false,
                          intent: .defaultIntent),
        let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

func writeRaw<T>(_ arr: [T], to url: URL) {
  arr.withUnsafeBytes { try! Data($0).write(to: url) }
}

let color = rgbaBytes(thumb, W, H)
writeRaw(color, to: outDir.appendingPathComponent("color.rgba"))
writePNG(color, W, H, gray: false, to: outDir.appendingPathComponent("color.png"))

// Maps a pixel of the oriented output (ox, oy) of size (ow, oh) back to the stored buffer (iw, ih).
func storedCoord(_ ox: Double, _ oy: Double, _ ow: Double, _ oh: Double, _ iw: Double, _ ih: Double) -> (Double, Double) {
  switch orientation {
  case .up: return (ox / ow * iw, oy / oh * ih)
  case .upMirrored: return ((1 - ox / ow) * iw, oy / oh * ih)
  case .down: return ((1 - ox / ow) * iw, (1 - oy / oh) * ih)
  case .downMirrored: return (ox / ow * iw, (1 - oy / oh) * ih)
  case .leftMirrored: return (oy / oh * iw, ox / ow * ih)
  case .right: return (oy / oh * iw, (1 - ox / ow) * ih)
  case .rightMirrored: return ((1 - oy / oh) * iw, (1 - ox / ow) * ih)
  case .left: return ((1 - oy / oh) * iw, ox / ow * ih)
  @unknown default: return (ox / ow * iw, oy / oh * ih)
  }
}

// Reads a one-channel pixel buffer as Float (UInt8 -> 0..1, Float16/32 as is) and resamples it to
// W x H with the photo's orientation applied (when the buffer is stored unrotated).
func resampleBuffer(_ pb: CVPixelBuffer, applyOrientation: Bool) -> [Float] {
  CVPixelBufferLockBaseAddress(pb, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
  let bw = CVPixelBufferGetWidth(pb)
  let bh = CVPixelBufferGetHeight(pb)
  let bpr = CVPixelBufferGetBytesPerRow(pb)
  let fmt = CVPixelBufferGetPixelFormatType(pb)
  let base = CVPixelBufferGetBaseAddress(pb)!
  func at(_ x: Int, _ y: Int) -> Float {
    let row = base.advanced(by: y * bpr)
    switch fmt {
    case kCVPixelFormatType_OneComponent8: return Float(row.load(fromByteOffset: x, as: UInt8.self)) / 255
    case kCVPixelFormatType_DisparityFloat16, kCVPixelFormatType_DepthFloat16, kCVPixelFormatType_OneComponent16Half:
      return Float(row.load(fromByteOffset: x * 2, as: Float16.self))
    case kCVPixelFormatType_DisparityFloat32, kCVPixelFormatType_DepthFloat32, kCVPixelFormatType_OneComponent32Float:
      return row.load(fromByteOffset: x * 4, as: Float.self)
    default: return Float(row.load(fromByteOffset: x, as: UInt8.self)) / 255
    }
  }
  var out = [Float](repeating: 0, count: W * H)
  for oy in 0..<H {
    for ox in 0..<W {
      var sx: Double
      var sy: Double
      if applyOrientation {
        (sx, sy) = storedCoord(Double(ox) + 0.5, Double(oy) + 0.5, Double(W), Double(H), Double(bw), Double(bh))
      } else {
        (sx, sy) = ((Double(ox) + 0.5) / Double(W) * Double(bw), (Double(oy) + 0.5) / Double(H) * Double(bh))
      }
      sx -= 0.5
      sy -= 0.5
      let x0 = max(0, min(bw - 1, Int(floor(sx))))
      let y0 = max(0, min(bh - 1, Int(floor(sy))))
      let x1 = min(bw - 1, x0 + 1)
      let y1 = min(bh - 1, y0 + 1)
      let tx = Float(max(0, min(1, sx - Double(x0))))
      let ty = Float(max(0, min(1, sy - Double(y0))))
      let v = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
      out[oy * W + ox] = v
    }
  }
  return out
}

func toBytes(_ f: [Float]) -> [UInt8] { f.map { UInt8(max(0, min(255, ($0 * 255).rounded()))) } }

var meta: [String: Any] = [
  "input": inURL.lastPathComponent,
  "fullWidth": fullW, "fullHeight": fullH,
  "width": W, "height": H,
  "orientation": orientationRaw,
  "focalLength35mm": exif[kCGImagePropertyExifFocalLenIn35mmFilm] ?? NSNull(),
  "focalLength": exif[kCGImagePropertyExifFocalLength] ?? NSNull(),
]
var aux: [String: Any] = [:]

// Auxiliary data the iPhone may have embedded (Portrait mode). These cropped copies usually have none.
var depthType = "none"
for (name, type) in [("disparity", kCGImageAuxiliaryDataTypeDisparity), ("depth", kCGImageAuxiliaryDataTypeDepth)] {
  if depthType != "none" { break }
  if let info = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, type) as? [AnyHashable: Any],
     var dd = try? AVDepthData(fromDictionaryRepresentation: info) {
    dd = dd.converting(toDepthDataType: kCVPixelFormatType_DisparityFloat32)
    let f = resampleBuffer(dd.depthDataMap, applyOrientation: true)
    writeRaw(f, to: outDir.appendingPathComponent("depth.f32"))
    depthType = name
    aux[name] = ["width": CVPixelBufferGetWidth(dd.depthDataMap), "height": CVPixelBufferGetHeight(dd.depthDataMap),
                 "accuracy": dd.depthDataAccuracy == .absolute ? "absolute" : "relative"]
  }
}
meta["depthType"] = depthType

var matteSource = "none"
if let info = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypePortraitEffectsMatte) as? [AnyHashable: Any],
   let m = try? AVPortraitEffectsMatte(fromDictionaryRepresentation: info) {
  let f = resampleBuffer(m.mattingImage, applyOrientation: true)
  writeRaw(toBytes(f), to: outDir.appendingPathComponent("matte.u8"))
  matteSource = "portrait-matte"
  aux["portraitMatte"] = true
}
for (name, type) in [("hair", kCGImageAuxiliaryDataTypeSemanticSegmentationHairMatte),
                     ("skin", kCGImageAuxiliaryDataTypeSemanticSegmentationSkinMatte)] {
  if let info = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, type) as? [AnyHashable: Any],
     let m = try? AVSemanticSegmentationMatte(fromImageSourceAuxiliaryDataType: type, dictionaryRepresentation: info) {
    let f = resampleBuffer(m.mattingImage, applyOrientation: true)
    writeRaw(toBytes(f), to: outDir.appendingPathComponent("\(name).u8"))
    aux[name] = true
  }
}
meta["aux"] = aux

// Vision on the oriented image.
let handler = VNImageRequestHandler(cgImage: thumb, orientation: .up, options: [:])
let seg = VNGeneratePersonSegmentationRequest()
seg.qualityLevel = .accurate
seg.outputPixelFormat = kCVPixelFormatType_OneComponent8
let faces = VNDetectFaceLandmarksRequest()
if #available(macOS 13.0, *) { faces.revision = VNDetectFaceLandmarksRequestRevision3 }
let body = VNDetectHumanBodyPoseRequest()
do { try handler.perform([seg, faces, body]) } catch { fail("Vision failed: \(error)") }

if let mask = seg.results?.first?.pixelBuffer {
  let f = resampleBuffer(mask, applyOrientation: false)
  let bytes = toBytes(f)
  writeRaw(bytes, to: outDir.appendingPathComponent("vision-matte.u8"))
  writePNG(bytes, W, H, gray: true, to: outDir.appendingPathComponent("vision-matte.png"))
  if matteSource == "none" {
    writeRaw(bytes, to: outDir.appendingPathComponent("matte.u8"))
    writePNG(bytes, W, H, gray: true, to: outDir.appendingPathComponent("matte.png"))
    matteSource = "vision-person-segmentation"
  }
  meta["visionMatteSize"] = [CVPixelBufferGetWidth(mask), CVPixelBufferGetHeight(mask)]
}
meta["matteSource"] = matteSource

// Pixel coordinates, origin top left.
func px(_ p: CGPoint) -> [Double] { [Double(p.x) * Double(W), (1 - Double(p.y)) * Double(H)] }

if let face = faces.results?.max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
  let bb = face.boundingBox
  var f: [String: Any] = [
    "box": [Double(bb.minX) * Double(W), (1 - Double(bb.maxY)) * Double(H), Double(bb.width) * Double(W), Double(bb.height) * Double(H)],
    "yawDeg": face.yaw.map { $0.doubleValue * 180 / .pi } ?? NSNull(),
    "rollDeg": face.roll.map { $0.doubleValue * 180 / .pi } ?? NSNull(),
    "pitchDeg": face.pitch.map { $0.doubleValue * 180 / .pi } ?? NSNull(),
  ]
  var regions: [String: Any] = [:]
  if let lm = face.landmarks {
    let named: [(String, VNFaceLandmarkRegion2D?)] = [
      ("faceContour", lm.faceContour), ("leftEye", lm.leftEye), ("rightEye", lm.rightEye),
      ("leftEyebrow", lm.leftEyebrow), ("rightEyebrow", lm.rightEyebrow), ("nose", lm.nose),
      ("noseCrest", lm.noseCrest), ("medianLine", lm.medianLine), ("outerLips", lm.outerLips),
      ("innerLips", lm.innerLips), ("leftPupil", lm.leftPupil), ("rightPupil", lm.rightPupil),
    ]
    for (name, region) in named {
      guard let r = region else { continue }
      let pts = r.pointsInImage(imageSize: CGSize(width: W, height: H))
      regions[name] = pts.map { [Double($0.x), Double(H) - Double($0.y)] }
    }
  }
  f["landmarks"] = regions
  meta["face"] = f
}

if let pose = body.results?.first, let pts = try? pose.recognizedPoints(.all) {
  var joints: [String: Any] = [:]
  for (k, v) in pts where v.confidence > 0.1 {
    joints[k.rawValue.rawValue] = ["x": Double(v.location.x) * Double(W), "y": (1 - Double(v.location.y)) * Double(H), "c": Double(v.confidence)]
  }
  meta["pose"] = joints
}

let json = try JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys])
try json.write(to: outDir.appendingPathComponent("meta.json"))
print("extract: \(inURL.lastPathComponent) -> \(outDir.path) [\(W)x\(H), matte: \(matteSource), depth: \(depthType)]")
