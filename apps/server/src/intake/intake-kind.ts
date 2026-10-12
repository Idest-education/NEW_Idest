import { IntakeKind } from '@prisma/client';
import { ALLOWED_IMAGE_MIME_TYPES } from '../cloudinary/image-upload.js';

const KIND_BY_EXTENSION: Record<string, IntakeKind> = {
  pdf: IntakeKind.pdf,
  doc: IntakeKind.doc,
  docx: IntakeKind.docx,
  xls: IntakeKind.xls,
  xlsx: IntakeKind.xlsx,
  csv: IntakeKind.csv,
  png: IntakeKind.image,
  jpg: IntakeKind.image,
  jpeg: IntakeKind.image,
  webp: IntakeKind.image,
  gif: IntakeKind.image,
  heic: IntakeKind.image,
  heif: IntakeKind.image,
};

/** What an uploaded file is, by extension first (office mimetypes vary by browser), or null if unsupported. */
export function intakeKind(file: Pick<Express.Multer.File, 'originalname' | 'mimetype'>): IntakeKind | null {
  const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  return KIND_BY_EXTENSION[ext] ?? (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype) ? IntakeKind.image : null);
}
