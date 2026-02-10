import type { BunFile } from "bun";
import type { ApiConfig } from "./config";

export async function s3FileUpload(
    cfg: ApiConfig,
    key: string,
    bunFile: BunFile,
    contentType: string,
) {
    const s3file = cfg.s3Client.file(key, { bucket: cfg.s3Bucket });
    await s3file.write(bunFile, { type: contentType });
}

/*
export async function generatePresignedURL(
    cfg: ApiConfig,
    key: string,
    expireTime: number,
) {
    return cfg.s3Client.presign(key, { bucket: cfg.s3Bucket, expiresIn: expireTime });
}
*/