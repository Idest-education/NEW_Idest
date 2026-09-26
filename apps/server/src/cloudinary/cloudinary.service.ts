import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

const logger = new Logger('CloudinaryService');

/**
 * Discrete vars win over CLOUDINARY_URL when both are set: they cannot be
 * mangled by `${...}`-style interpolation, which dotenv does not expand
 * (unlike a shell) — a CLOUDINARY_URL built from `${CLOUDINARY_API_KEY}` in a
 * .env file carries that literal text, not the referenced value.
 */
function resolveCredentials(configService: ConfigService): {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
} {
  const url = configService.get<string>('CLOUDINARY_URL');
  let fromUrl: { cloudName?: string; apiKey?: string; apiSecret?: string } = {};

  if (url) {
    try {
      const parsed = new URL(url);
      fromUrl = {
        cloudName: parsed.hostname || undefined,
        apiKey: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        apiSecret: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      };
    } catch {
      logger.warn('CLOUDINARY_URL is set but is not a valid URL; ignoring it');
    }
  }

  return {
    cloudName: configService.get<string>('CLOUDINARY_CLOUD_NAME') ?? fromUrl.cloudName,
    apiKey: configService.get<string>('CLOUDINARY_API_KEY') ?? fromUrl.apiKey,
    apiSecret: configService.get<string>('CLOUDINARY_API_SECRET') ?? fromUrl.apiSecret,
  };
}

@Injectable()
export class CloudinaryService {
  constructor(configService: ConfigService) {
    const { cloudName, apiKey, apiSecret } = resolveCredentials(configService);

    if (!cloudName || !apiKey || !apiSecret) {
      const missing = [
        !cloudName && 'cloud_name',
        !apiKey && 'api_key',
        !apiSecret && 'api_secret',
      ].filter(Boolean);
      logger.error(
        `Cloudinary is not configured (missing ${missing.join(', ')}). Set CLOUDINARY_URL ` +
          '(cloudinary://<api_key>:<api_secret>@<cloud_name>) or CLOUDINARY_CLOUD_NAME, ' +
          'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET. Task image upload will fail until this is fixed.',
      );
    }

    // Passed explicitly rather than left to the SDK's own CLOUDINARY_URL
    // auto-parse: that only runs on the first call to `cloudinary.config()`
    // and reads `process.env` directly at that instant, so it can silently
    // miss a value dotenv only just finished loading. ConfigService is
    // guaranteed populated by the time any provider is constructed.
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  }

  uploadImage(buffer: Buffer, folder: string): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload returned no result'));
          return;
        }
        resolve(result);
      });
      stream.end(buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
