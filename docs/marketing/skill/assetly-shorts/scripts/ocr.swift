// ocr <png>... : prints one JSON array per image of [text, x0, y0, x1, y1, conf] in image pixels (top-left origin)
import Foundation
import Vision
import AppKit
var out: [[[Any]]] = []
for p in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: p), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { out.append([]); continue }
    let W = Double(cg.width), H = Double(cg.height)
    let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    var rows: [[Any]] = []
    for o in req.results ?? [] {
        guard let c = o.topCandidates(1).first else { continue }
        let b = o.boundingBox
        rows.append([c.string, Int(b.minX * W), Int((1 - b.maxY) * H), Int(b.maxX * W), Int((1 - b.minY) * H), Double(c.confidence)])
    }
    out.append(rows)
}
let d = try! JSONSerialization.data(withJSONObject: out)
print(String(data: d, encoding: .utf8)!)
