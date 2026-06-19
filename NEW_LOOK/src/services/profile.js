import { get, put } from "./storage/db.js";

const STORE = "profile";
const PROFILE_ID = "default";

export const DEFAULT_PROFILE = {
  id: PROFILE_ID,
  displayName: "QuizNest Learner",
  avatarDataUrl: "",
  updatedAt: ""
};

export async function getProfile() {
  return {
    ...DEFAULT_PROFILE,
    ...((await get(STORE, PROFILE_ID)) || {})
  };
}

export async function saveProfile(profile) {
  return put(STORE, {
    ...DEFAULT_PROFILE,
    ...profile,
    id: PROFILE_ID,
    displayName: String(profile?.displayName || DEFAULT_PROFILE.displayName).trim() || DEFAULT_PROFILE.displayName,
    avatarDataUrl: profile?.avatarDataUrl || "",
    updatedAt: new Date().toISOString()
  });
}

export function profileInitials(name) {
  const text = String(name || DEFAULT_PROFILE.displayName).trim();
  const cjk = text.match(/[\u3400-\u9fff]/g);
  if (cjk?.length) return cjk.slice(0, 2).join("");
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "QN";
}
