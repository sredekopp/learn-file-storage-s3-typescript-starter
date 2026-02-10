import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID != userID) {
    throw new UserForbiddenError("You don't own this video");
  }

  const formData = await req.formData()
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB
  const data = await file.arrayBuffer();
  if (data.byteLength > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video exceeds 10MB size limit");
  }

  const mimeMap: { [key: string]: string } = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
//    'image/gif': '.gif',
//    'application/pdf': '.pdf',
//    'text/plain': '.txt',
//    'video/mp4': '.mp4',
  };
  const fileExt = mimeMap[file.type];
  if (!fileExt) {
    throw new BadRequestError(`Unsupported Mime type: ${file.type}`);
  }
  const fileName = `${randomBytes(32).toString("base64url")}${fileExt}`;
  const filepath = path.join(cfg.assetsRoot, `${fileName}`);
  
  await Bun.write(filepath, data);

  video.thumbnailURL = `http://localhost:${cfg.port}/assets/${fileName}`;
  updateVideo(cfg.db, video);


  return respondWithJSON(200, video);
}
