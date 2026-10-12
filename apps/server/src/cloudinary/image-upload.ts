import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

// Kept to formats at least one configured grader can actually see (Gemini
// reads HEIC/HEIF; OpenAI does not, but the rotation just falls through to
// Gemini on a 4xx). SVG/BMP/TIFF/AVIF are left out: no vision provider reads them,
// so accepting them would only produce essays graded against no picture.
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

/** Multer fileFilter that rejects images no grader can read. */
export function imageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, accept: boolean) => void,
): void {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException({ error: 'unsupported_image_type' }), false);
    return;
  }
  callback(null, true);
}
