import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getWhatsAppConfig } from "@/lib/server/whatsapp/config";

const DEFAULT_MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type WhatsAppMediaMetadata = {
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
};

function getMaxMediaBytes() {
  const configured = Number(process.env.WHATSAPP_MAX_IMAGE_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MEDIA_BYTES;
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "whatsapp-image";
}

function extensionForMimeType(mimeType: string) {
  return SUPPORTED_IMAGE_TYPES[mimeType.toLowerCase()];
}

async function getWhatsAppMediaMetadata(mediaId: string) {
  const config = getWhatsAppConfig();

  if (!config.accessToken) {
    throw new Error("WhatsApp access token is missing.");
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(mediaId)}`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    },
  );
  const data = (await response.json().catch(() => null)) as WhatsAppMediaMetadata | null;

  if (!response.ok || !data?.url) {
    throw new Error("Unable to read WhatsApp media metadata.");
  }

  return data;
}

export async function downloadAndStoreWhatsAppImage({
  mediaId,
  mimeType,
}: {
  mediaId: string;
  mimeType?: string;
}) {
  const config = getWhatsAppConfig();
  const metadata = await getWhatsAppMediaMetadata(mediaId);
  const resolvedMimeType = metadata.mime_type || mimeType || "";
  const extension = extensionForMimeType(resolvedMimeType);

  if (!extension) {
    throw new Error("Unsupported WhatsApp image type.");
  }

  if (typeof metadata.file_size === "number" && metadata.file_size > getMaxMediaBytes()) {
    throw new Error("WhatsApp image is too large.");
  }

  if (!config.accessToken) {
    throw new Error("WhatsApp access token is missing.");
  }

  // Meta returns a short-lived media URL. The binary download must also include
  // the Graph API bearer token; the URL is not public and should not be stored.
  const mediaUrl = metadata.url;
  if (!mediaUrl) {
    throw new Error("WhatsApp media URL is missing.");
  }

  const mediaResponse = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  if (!mediaResponse.ok) {
    throw new Error("WhatsApp image download failed.");
  }

  const contentType = mediaResponse.headers.get("content-type")?.split(";")[0].trim() || "";
  const downloadedExtension = extensionForMimeType(contentType || resolvedMimeType);

  if (!downloadedExtension) {
    throw new Error("Downloaded WhatsApp media is not a supported image.");
  }

  const bytes = Buffer.from(await mediaResponse.arrayBuffer());
  if (bytes.byteLength > getMaxMediaBytes()) {
    throw new Error("WhatsApp image is too large.");
  }

  const uploadRoot = process.env.VERCEL ? os.tmpdir() : path.join(process.cwd(), "public");
  const uploadDirectory = path.join(uploadRoot, "uploads", "whatsapp");
  await mkdir(uploadDirectory, { recursive: true });

  const safeMediaId = sanitizeFileSegment(mediaId);
  const safeHash = sanitizeFileSegment(metadata.sha256 || Date.now().toString(36));
  const fileName = `${safeMediaId}-${safeHash}.${downloadedExtension}`;
  const filePath = path.join(uploadDirectory, fileName);

  // Local and traditional Node deployments can serve public/uploads directly.
  // Serverless production should swap this write for durable object storage.
  await writeFile(filePath, bytes);

  return {
    imageUrl: `/uploads/whatsapp/${fileName}`,
    mimeType: contentType || resolvedMimeType,
    size: bytes.byteLength,
  };
}
