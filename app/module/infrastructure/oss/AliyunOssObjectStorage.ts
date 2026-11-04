import { AccessLevel, SingletonProto } from '@eggjs/tegg';
import OSS from 'ali-oss';
import { AppError } from '../../system/error/AppError';
import {
  ObjectStorage,
  type ObjectMetadata,
  type SignedUpload,
  type UploadRequest,
} from '../../speech/service/SpeechPorts';

@SingletonProto({ name: 'ObjectStorage', accessLevel: AccessLevel.PUBLIC })
export class AliyunOssObjectStorage extends ObjectStorage {
  async createUploadUrl(input: UploadRequest): Promise<SignedUpload> {
    const headers = { 'Content-Type': input.contentType };
    const url = await this.client().signatureUrlV4(
      'PUT', input.expiresInSeconds, { headers }, input.key,
    );
    return {
      url,
      headers,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async headObject(key: string): Promise<ObjectMetadata> {
    try {
      const result = await this.client().head(key);
      const headers = result.res.headers as Record<string, string | number | undefined>;
      return {
        sizeBytes: Number(headers['content-length'] ?? 0),
        contentType: String(headers['content-type'] ?? '').toLowerCase(),
      };
    } catch {
      throw new AppError('AUDIO_UPLOAD_MISMATCH', '上传的音频不存在或不可读取');
    }
  }

  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.client().signatureUrlV4('GET', expiresInSeconds, undefined, key);
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client().delete(key);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error
        && error.status === 404) return;
      throw error;
    }
  }

  private client(): OSS {
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
    const bucket = process.env.OSS_BUCKET;
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new AppError('SPEECH_PROVIDER_UNAVAILABLE', '对象存储暂未配置', 503);
    }
    return new OSS({
      accessKeyId,
      accessKeySecret,
      bucket,
      region: process.env.OSS_REGION ?? 'oss-cn-beijing',
      secure: true,
      authorizationV4: true,
      ...(process.env.OSS_ENDPOINT ? { endpoint: process.env.OSS_ENDPOINT } : {}),
    });
  }
}
