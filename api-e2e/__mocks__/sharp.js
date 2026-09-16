const sharp = jest.fn(() => ({
  resize: jest.fn().mockReturnThis(),
  rotate: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  webp: jest.fn().mockReturnThis(),
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('')),
  toFile: jest.fn().mockResolvedValue({ size: 0 }),
  metadata: jest.fn().mockResolvedValue({ width: 100, height: 100, format: 'jpeg' }),
}));
sharp.cache = jest.fn();
module.exports = sharp;
