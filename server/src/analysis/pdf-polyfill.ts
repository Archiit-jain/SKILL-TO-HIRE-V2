// pdf.js expects browser globals (DOMMatrix, ImageData, Path2D). It tries to load @napi-rs/canvas through a dynamic
// require that serverless bundlers (Vercel's file tracer) cannot see, so the function crashed on import.
// Importing the package statically here makes the bundler include it and installs the globals before pdf.js loads.
import * as canvas from "@napi-rs/canvas";

const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= canvas.DOMMatrix;
g.ImageData ??= canvas.ImageData;
g.Path2D ??= canvas.Path2D;
