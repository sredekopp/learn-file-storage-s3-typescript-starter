import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunFile, BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { randomBytes } from "crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { s3FileUpload } from "../s3";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading file for video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID != userID) {
    throw new UserForbiddenError("You don't own this video");
  }
  
  const formData = await req.formData()
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB
  const data = await file.arrayBuffer();
  if (data.byteLength > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video exceeds 1GB size limit");
  }

  const mimeMap: { [key: string]: string } = {
//    'image/jpeg': '.jpg',
//    'image/png': '.png',
//    'image/gif': '.gif',
//    'application/pdf': '.pdf',
//    'text/plain': '.txt',
    'video/mp4': '.mp4',
  };
  const fileExt = mimeMap[file.type];
  if (!fileExt) {
    throw new BadRequestError(`Unsupported Mime type: ${file.type}`);
  }
  const fileName = `${randomBytes(32).toString("base64url")}${fileExt}`;
  const tempFilePath = path.join(tmpdir(), `${fileName}`);

  const tempBunFile = Bun.file(tempFilePath);
  await Bun.write(tempBunFile, data);

  const fastFilePath = await processVideoForFastStart(tempFilePath);
  const tempFastBunFile = Bun.file(fastFilePath);

  const aspect = await getVideoAspectRatio(tempFilePath);
  const key = `${aspect}/${fileName}`;

  s3FileUpload(cfg, key, tempFastBunFile, file.type);
  video.videoURL = `https://${cfg.s3CfDistribution}.cloudfront.net/${key}`;
  updateVideo(cfg.db, video);

  await Promise.all([
    rm(tempFilePath, { force: true }),
    rm(fastFilePath, { force: true }),
  ]);
  
  return respondWithJSON(200, video);
}

async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath]);
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  const errorLevel = await proc.exited;
  if (errorLevel != 0) {
    throw new BadRequestError(`Error inspecting aspect ratio: ${stderrText}`);
  }

  const probeData = JSON.parse(stdoutText);
  const stream = probeData.streams[0];
  if ((!stream.width || !stream.height) || (stream.width == 0 || stream.height == 0)) {
    throw new BadRequestError("Missing aspect ratio infomation");
  }

  return Math.floor(stream.width / stream.height) == 1 ? "landscape" : "portrait";
}

async function processVideoForFastStart(inputFilePath: string): Promise<string> {
  const processedFilePath = `${inputFilePath}.processed`;
  const proc = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", processedFilePath]);
  const errorLevel = await proc.exited;
  if (errorLevel != 0) {
    throw new BadRequestError("Error converting video for fast start");
  }
  return processedFilePath;
}

/*
export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) {
    return video;
  }
  video.videoURL = await generatePresignedURL(cfg, video.videoURL, 5 * 60);
  return video;
}
*/