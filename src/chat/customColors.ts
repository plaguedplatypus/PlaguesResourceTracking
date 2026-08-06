import * as a1lib from "alt1/base";

// Ordered by OCR priority. Each color is retained only for tracker text
export const trackerChatColors = [
  a1lib.mixColor(255, 255, 255), // Normal tracked text and timestamp brackets.
  a1lib.mixColor(127, 169, 255), // Timestamp digits.
  a1lib.mixColor(255, 0, 0), // Red invention material names.

  a1lib.mixColor(245, 135, 55), // Orange invention material names.
  a1lib.mixColor(255, 128, 0), // Orange invention component variant.
  a1lib.mixColor(235, 119, 3), // 10pt orange component variant.

  a1lib.mixColor(67, 188, 188), // Teal invention component names.
  a1lib.mixColor(0, 255, 0), // Bright green Forge Phoenix/Fire Spirit rewards.
  
  a1lib.mixColor(51, 197, 20), // Faded green spirit reward variant.
  a1lib.mixColor(59, 181, 20), // Green spirit reward variant.
  a1lib.mixColor(59, 181, 30), // Green reward anti-aliasing variant.
  a1lib.mixColor(59, 176, 30), // 10pt-12pt Green spirit reward variant.
  a1lib.mixColor(41, 77, 27), // Green Anti-aliasing.
  a1lib.mixColor(40, 67, 28), // Green Anti-aliasing
  
  a1lib.mixColor(0, 255, 255), // Seren spirit reward text.
  a1lib.mixColor(127, 255, 255), // Seren reward anti-aliasing variant.
];
