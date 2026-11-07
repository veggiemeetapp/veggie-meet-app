import { describe, expect, it } from "vitest";
import {
  ImageUploadError,
  IMAGE_UPLOAD_COPY,
  MAX_AVATAR_SOURCE_BYTES,
  validateAvatarFile,
} from "./imageUpload";
import { memberSafeMessage, normalizeError } from "./errors";

const f = (over: Partial<Pick<File, "type" | "size" | "name">>) => ({
  type: "image/jpeg",
  size: 1024,
  name: "photo.jpg",
  ...over,
});

describe("validateAvatarFile", () => {
  it("accepts common phone photo types including HEIC", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/HEIF"]) {
      expect(() => validateAvatarFile(f({ type }))).not.toThrow();
    }
  });

  it("accepts a typical 12 MB phone photo (it is downscaled before upload)", () => {
    expect(() => validateAvatarFile(f({ size: 12 * 1024 * 1024 }))).not.toThrow();
  });

  it("rejects only truly oversized sources with member-safe copy", () => {
    expect(() => validateAvatarFile(f({ size: MAX_AVATAR_SOURCE_BYTES + 1 }))).toThrow(
      IMAGE_UPLOAD_COPY.size,
    );
  });

  it("allows an empty MIME type when the extension is an image (iOS Files picker)", () => {
    expect(() => validateAvatarFile(f({ type: "", name: "IMG_0001.HEIC" }))).not.toThrow();
    expect(() => validateAvatarFile(f({ type: "", name: "notes.pdf" }))).toThrow(IMAGE_UPLOAD_COPY.mime);
  });

  it("rejects non-image types", () => {
    expect(() => validateAvatarFile(f({ type: "application/pdf" }))).toThrow(IMAGE_UPLOAD_COPY.mime);
  });
});

describe("normalizeError with ImageUploadError", () => {
  it("shows the actionable upload copy instead of the generic fallback", () => {
    const e = new ImageUploadError("size", IMAGE_UPLOAD_COPY.size);
    expect(normalizeError(e).category).toBe("domain");
    expect(memberSafeMessage(e)).toBe(IMAGE_UPLOAD_COPY.size);
    expect(memberSafeMessage(e)).not.toMatch(/something went wrong/i);
  });

  it("never leaks the raw storage cause", () => {
    const e = new ImageUploadError("upload", IMAGE_UPLOAD_COPY.upload, {
      cause: new Error("new row violates row-level security policy"),
    });
    const n = normalizeError(e);
    expect(n.title).toBe(IMAGE_UPLOAD_COPY.upload);
    expect(n.retryable).toBe(true);
    expect(memberSafeMessage(e)).not.toMatch(/row-level/i);
  });
});
