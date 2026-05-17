// splitlens-vision: shell-out OCR helper for SplitLens.
//
// Usage:   splitlens-vision <image-path>
// Output:  JSON to stdout — { "lines": [...], "blocks": [{ "text", "confidence", "x", "y", "w", "h" }] }
// Errors:  JSON to stdout — { "error": "<msg>" }; non-zero exit code.
//
// Uses the system Vision framework (VNRecognizeTextRequest) — entirely on-device.
// No cloud calls. Bundled with macOS, no third-party deps. Compiled with `swiftc -O`.

import Foundation
import Vision
import CoreGraphics
import ImageIO

struct Block: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct OCRResult: Codable {
    let lines: [String]
    let blocks: [Block]
}

struct OCRError: Codable {
    let error: String
}

func emit<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    if let data = try? encoder.encode(value),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

func fail(_ message: String) -> Never {
    emit(OCRError(error: message))
    exit(1)
}

guard CommandLine.arguments.count >= 2 else {
    fail("usage: splitlens-vision <image-path>")
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)

guard FileManager.default.fileExists(atPath: path) else {
    fail("file not found: \(path)")
}

guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("could not decode image at: \(path)")
}

// Vision returns coordinates in [0, 1] normalized to the image. We convert
// to pixel space so downstream parsers can reason in pixels.
let imageWidth = Double(cgImage.width)
let imageHeight = Double(cgImage.height)

let request = VNRecognizeTextRequest { (req, err) in
    if let err = err {
        fail("Vision error: \(err.localizedDescription)")
    }

    guard let observations = req.results as? [VNRecognizedTextObservation] else {
        emit(OCRResult(lines: [], blocks: []))
        return
    }

    var lines: [String] = []
    var blocks: [Block] = []

    for obs in observations {
        guard let top = obs.topCandidates(1).first else { continue }
        lines.append(top.string)

        // Vision's bounding box origin is bottom-left, range [0, 1]. Flip Y so
        // it matches the more common top-left convention parsers expect.
        let bbox = obs.boundingBox
        let x = Double(bbox.minX) * imageWidth
        let y = (1.0 - Double(bbox.maxY)) * imageHeight
        let w = Double(bbox.width) * imageWidth
        let h = Double(bbox.height) * imageHeight

        blocks.append(Block(
            text: top.string,
            confidence: top.confidence,
            x: x,
            y: y,
            w: w,
            h: h
        ))
    }

    emit(OCRResult(lines: lines, blocks: blocks))
}

// Accurate mode is slower but much better on the small, dense type that
// quick-commerce receipts use. Language correction off — receipts have lots
// of proper nouns Vision's language model loves to "fix" into nonsense.
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US", "en-IN"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    fail("Vision perform failed: \(error.localizedDescription)")
}
