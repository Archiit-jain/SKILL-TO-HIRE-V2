// Inert stand-in for @napi-rs/canvas inside the parse worker (security remediation P2, D-11; see parse-worker.ts).
// pdf.js needs these names to exist when it loads, but text extraction never renders, so nothing here draws anything.
class DOMMatrix {
  constructor() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
  }
}
class ImageData {}
class Path2D {}
class Canvas {}
function createCanvas() {
  throw new Error("rendering is not available in the parse worker");
}

module.exports = { DOMMatrix, ImageData, Path2D, Canvas, createCanvas };
