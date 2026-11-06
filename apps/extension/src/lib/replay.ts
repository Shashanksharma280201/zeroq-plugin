import type { WardrobeItem, ZQEvent } from "@zq/core";
import { applyWorn, deleteBlob, deleteItemRaw, getBlob, getMeta, putBlob, putItemRaw, setMeta } from "./db.ts";

/**
 * Replays an event that came from somewhere else (your Drive, your data
 * folder, a backup) onto this browser: wardrobe, worn counts, profile,
 * photos. Shared by every way data comes in, so they all agree.
 */

export interface BlobRef {
  key: string;
  hash: string;
}

/** Photos an event depends on. */
export function blobRefs(e: ZQEvent): BlobRef[] {
  const p = e.payload ?? {};
  if ((e.type === "wardrobe_added" || e.type === "wardrobe_updated") && p.item?.image && p.blobHash) return [{ key: p.item.image, hash: p.blobHash }];
  if (e.type === "profile_built" && Array.isArray(p.photos)) return p.photos.filter((x: any) => x?.key && x?.hash);
  if (e.type === "photo_set" && p.key && p.hash) return [{ key: p.key, hash: p.hash }];
  if (e.type === "item_rated" && p.thumbKey && p.thumbHash) return [{ key: p.thumbKey, hash: p.thumbHash }];
  return [];
}

export async function replay(e: ZQEvent, loadBlob: (ref: BlobRef) => Promise<Blob | undefined>): Promise<void> {
  const p = e.payload ?? {};
  for (const ref of blobRefs(e)) {
    try {
      if ((await getMeta<string>(`hash:${ref.key}`)) === ref.hash && (await getBlob(ref.key))) continue;
      const b = await loadBlob(ref);
      if (!b) continue;
      await putBlob(ref.key, b);
      await setMeta(`hash:${ref.key}`, ref.hash);
    } catch {}
  }
  switch (e.type) {
    case "wardrobe_added":
    case "wardrobe_updated":
      if (p.item?.id) await putItemRaw(p.item as WardrobeItem);
      break;
    case "wardrobe_removed":
      if (p.id) {
        await deleteItemRaw(p.id);
        await deleteBlob(`item:${p.id}`).catch(() => {});
      }
      break;
    case "outfit_worn":
      if (Array.isArray(p.itemIds)) await applyWorn(p.itemIds, e.ts);
      break;
    case "profile_built": {
      const local = (await chrome.storage.local.get("profile")).profile;
      const localAt = local?.updatedAt ?? local?.createdAt ?? "";
      if (e.ts < localAt) break; // yours is newer
      if (p.profile) await chrome.storage.local.set({ profile: p.profile });
      else await chrome.storage.local.remove("profile");
      break;
    }
    case "photo_set": {
      const st = (await chrome.storage.local.get("settings")).settings ?? {};
      await chrome.storage.local.set({ settings: { ...st, hasModelPhoto: true } });
      break;
    }
  }
}
