"use client";

import { generateTicketId } from "@/lib/ticketId";
import type {
  AppUser,
  ComplaintComment,
  ComplaintRecord,
  ComplaintStatus,
  ComplaintTimelineItem,
  Profile,
  Role,
  StoredUser,
} from "@/lib/types";

const USERS_STORAGE_KEY = "fmc_local_users_v2";
const REPORTS_STORAGE_KEY = "fmc_local_reports_v2";

function canUseStorage() {
  return typeof window !== "undefined";
}

function readStorage<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function sha256(value: string) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function deriveDisplayName(currentName: string, profile: Profile) {
  if (!profile) return currentName;

  const nextName = [profile.firstName, profile.lastName]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .trim();

  return nextName || currentName;
}

function sanitizeUser(user: StoredUser): AppUser {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
  };
}

export function getLocalUsers() {
  return readStorage<StoredUser[]>(USERS_STORAGE_KEY, []);
}

function saveLocalUsers(users: StoredUser[]) {
  writeStorage(USERS_STORAGE_KEY, users);
}

export function findLocalUser(email: string) {
  const normalizedEmail = normalizeEmail(email);
  return getLocalUsers().find((user) => user.email === normalizedEmail) ?? null;
}

export async function createLocalUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  const users = getLocalUsers();
  const normalizedEmail = normalizeEmail(input.email);

  if (users.some((user) => user.email === normalizedEmail)) {
    throw new Error("An account with this email already exists.");
  }

  const now = new Date().toISOString();
  const nextUser: StoredUser = {
    name: input.name.trim(),
    email: normalizedEmail,
    role: "user",
    passwordHash: await sha256(input.password),
    profile: {
      firstName: input.name.trim(),
    },
    createdAt: now,
    updatedAt: now,
  };

  saveLocalUsers([nextUser, ...users]);
  return nextUser;
}

export async function loginLocalUser(input: {
  email: string;
  password: string;
  role: Role;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await sha256(input.password);
  const user = findLocalUser(normalizedEmail);

  if (!user) {
    throw new Error("No account found with this email.");
  }

  if (user.role !== input.role) {
    throw new Error(
      input.role === "admin"
        ? "This account does not have admin access."
        : "Please choose the correct login type for this account.",
    );
  }

  if (user.passwordHash !== passwordHash) {
    throw new Error("Incorrect password.");
  }

  return user;
}

export function upsertLocalUserRecord(user: AppUser, profile: Profile) {
  const users = getLocalUsers();
  const index = users.findIndex((entry) => entry.email === user.email);
  const now = new Date().toISOString();

  if (index === -1) {
    const nextUser: StoredUser = {
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      passwordHash: "",
      profile,
      createdAt: now,
      updatedAt: now,
    };
    saveLocalUsers([nextUser, ...users]);
    return;
  }

  const nextUsers = [...users];
  nextUsers[index] = {
    ...nextUsers[index],
    name: user.name,
    role: user.role,
    department: user.department,
    profile,
    updatedAt: now,
  };
  saveLocalUsers(nextUsers);
}

export function updateLocalUserProfile(email: string, profile: NonNullable<Profile>) {
  const users = getLocalUsers();
  const normalizedEmail = normalizeEmail(email);
  const index = users.findIndex((user) => user.email === normalizedEmail);

  if (index === -1) {
    throw new Error("User not found.");
  }

  const nextUsers = [...users];
  nextUsers[index] = {
    ...nextUsers[index],
    profile,
    name: deriveDisplayName(nextUsers[index].name, profile),
    updatedAt: new Date().toISOString(),
  };
  saveLocalUsers(nextUsers);
  return nextUsers[index];
}

export function getLocalReports() {
  return readStorage<ComplaintRecord[]>(REPORTS_STORAGE_KEY, []);
}

function saveLocalReports(reports: ComplaintRecord[]) {
  writeStorage(REPORTS_STORAGE_KEY, reports);
}

export function mergeAndStoreReports(reports: ComplaintRecord[]) {
  const merged = new Map<string, ComplaintRecord>();

  for (const report of getLocalReports()) {
    merged.set(report.ticketId, report);
  }

  for (const report of reports) {
    const existing = merged.get(report.ticketId);
    if (!existing || existing.updatedAt <= report.updatedAt) {
      merged.set(report.ticketId, report);
    }
  }

  const nextReports = Array.from(merged.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  saveLocalReports(nextReports);
  return nextReports;
}

export function upsertLocalReport(report: ComplaintRecord) {
  return mergeAndStoreReports([report]);
}

export function findLocalReport(ticketId: string) {
  return getLocalReports().find((report) => report.ticketId === ticketId) ?? null;
}

export function findLocalReportForUser(ticketId: string, userEmail: string, role: Role) {
  const report = findLocalReport(ticketId);
  if (!report) return null;
  if (role === "admin") return report;
  return report.userEmail === normalizeEmail(userEmail) ? report : null;
}

function inferDepartment(category: string, description = "") {
  const normalized = `${category} ${description}`.toLowerCase();

  if (normalized.includes("garbage") || normalized.includes("waste")) return "Sanitation";
  if (normalized.includes("pothole") || normalized.includes("road")) return "Public Works";
  if (normalized.includes("streetlight") || normalized.includes("light")) return "Electricity";
  if (normalized.includes("sewer") || normalized.includes("drain")) return "Sewerage";
  if (normalized.includes("water") || normalized.includes("leak")) return "Water Supply";
  if (normalized.includes("traffic") || normalized.includes("signal")) return "Traffic Police";
  if (normalized.includes("park") || normalized.includes("tree")) return "Horticulture";
  return "General Complaints Cell";
}

function pickComplaintImage(category: string, fallbackPhotoUrl?: string) {
  if (fallbackPhotoUrl && fallbackPhotoUrl.trim() !== "") {
    return fallbackPhotoUrl;
  }

  const normalized = category.toLowerCase();
  if (normalized.includes("garbage")) return "/garbage.jpg";
  if (normalized.includes("streetlight") || normalized.includes("light")) return "/streetlight.jpg";
  if (normalized.includes("water")) return "/clear-water-ripples.png";
  if (normalized.includes("traffic")) return "/busy-city-traffic.png";
  return "/pothole.png";
}

function buildComplaintTimeline(createdAt: string): ComplaintTimelineItem[] {
  return [
    { status: "Submitted", date: createdAt, completed: true },
    { status: "Assigned", date: "Pending assignment", completed: false },
    { status: "In Progress", date: "Waiting for action", completed: false },
    { status: "Resolved", date: "Pending resolution", completed: false },
  ];
}

function buildLocation(address: string, city: string, pincode: string, landmark?: string) {
  return [address, landmark, city, pincode].filter(Boolean).join(", ");
}

function deriveUrgencyFromUpvotes(currentUrgency: "Low" | "Medium" | "High", upvotes: number) {
  if (currentUrgency === "High" || upvotes >= 10) return "High";
  if (currentUrgency === "Medium" || upvotes >= 5) return "Medium";
  return "Low";
}

function buildUpdatedTimeline(
  timeline: ComplaintTimelineItem[],
  nextStatus: ComplaintStatus,
  updatedAt: string,
) {
  const sequence: ComplaintStatus[] = ["Submitted", "Assigned", "In Progress", "Resolved"];
  const nextStatusIndex = sequence.indexOf(nextStatus);

  return sequence.map((status, index) => {
    const existingItem = timeline.find((item) => item.status === status);

    if (index < nextStatusIndex) {
      return {
        status,
        date:
          existingItem?.date &&
          !["Pending assignment", "Waiting for action", "Pending resolution"].includes(existingItem.date)
            ? existingItem.date
            : updatedAt,
        completed: true,
      };
    }

    if (index === nextStatusIndex) {
      return { status, date: updatedAt, completed: true };
    }

    if (status === "Assigned") return { status, date: "Pending assignment", completed: false };
    if (status === "In Progress") return { status, date: "Waiting for action", completed: false };
    return { status, date: "Pending resolution", completed: false };
  });
}

export function createLocalFallbackComplaint(input: {
  userEmail: string;
  userName: string;
  category: string;
  description: string;
  address: string;
  exactLocation?: string;
  landmark?: string;
  city: string;
  pincode: string;
  urgency: "Low" | "Medium" | "High";
  photoUrl?: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
}) {
  const now = new Date().toISOString();
  const assignedDepartment = inferDepartment(input.category, input.description);
  const photoUrl = pickComplaintImage(input.category, input.imageUrl || input.photoUrl);
  const complaint: ComplaintRecord = {
    ticketId: generateTicketId(),
    userEmail: normalizeEmail(input.userEmail),
    userName: input.userName,
    title: `${input.category} reported in ${input.city}`,
    category: input.category,
    description: input.description,
    address: input.exactLocation || input.address,
    exactLocation: input.exactLocation || input.address,
    landmark: input.landmark,
    city: input.city,
    pincode: input.pincode,
    location: buildLocation(input.exactLocation || input.address, input.city, input.pincode, input.landmark),
    latitude: input.latitude,
    longitude: input.longitude,
    urgency: input.urgency,
    photoUrl,
    imageUrl: input.imageUrl || input.photoUrl || photoUrl,
    status: "Submitted",
    upvotes: 0,
    likedBy: [],
    comments: [],
    commentsCount: 0,
    assignedDepartment,
    officer: {
      name: `${assignedDepartment} Desk`,
      email: "support@fixmycity.com",
      role: "Complaint Officer",
      phone: "+91 98765 12000",
      department: assignedDepartment,
    },
    timeline: buildComplaintTimeline(now),
    createdAt: now,
    updatedAt: now,
  };

  upsertLocalReport(complaint);
  return complaint;
}

export function toggleLocalReportUpvote(ticketId: string, actorId: string) {
  const reports = getLocalReports();
  const index = reports.findIndex((report) => report.ticketId === ticketId);
  if (index === -1) throw new Error("Complaint not found.");

  const nextReports = [...reports];
  const report = { ...nextReports[index] };
  const likedBy = Array.isArray(report.likedBy) ? [...report.likedBy] : [];
  const normalizedActorId = actorId.trim().toLowerCase();
  const existingIndex = likedBy.indexOf(normalizedActorId);
  const liked = existingIndex === -1;

  if (liked) {
    likedBy.push(normalizedActorId);
  } else {
    likedBy.splice(existingIndex, 1);
  }

  report.likedBy = likedBy;
  report.upvotes = likedBy.length;
  report.urgency = deriveUrgencyFromUpvotes(report.urgency, report.upvotes);
  report.updatedAt = new Date().toISOString();
  nextReports[index] = report;
  saveLocalReports(nextReports);
  return { complaint: report, liked };
}

export function addLocalReportComment(input: {
  ticketId: string;
  authorId: string;
  authorName: string;
  body: string;
}) {
  const reports = getLocalReports();
  const index = reports.findIndex((report) => report.ticketId === input.ticketId);
  if (index === -1) throw new Error("Complaint not found.");

  const nextReports = [...reports];
  const report = { ...nextReports[index] };
  const comments = Array.isArray(report.comments) ? [...report.comments] : [];
  const now = new Date().toISOString();
  const comment: ComplaintComment = {
    id: `CMT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    authorId: input.authorId.trim().toLowerCase(),
    authorName: input.authorName.trim() || "Community Member",
    body: input.body.trim(),
    createdAt: now,
  };

  comments.push(comment);
  report.comments = comments;
  report.commentsCount = comments.length;
  report.updatedAt = now;
  nextReports[index] = report;
  saveLocalReports(nextReports);
  return { complaint: report, comment };
}

export function updateLocalReportStatus(ticketId: string, nextStatus: ComplaintStatus) {
  const reports = getLocalReports();
  const index = reports.findIndex((report) => report.ticketId === ticketId);
  if (index === -1) throw new Error("Complaint not found.");

  const nextReports = [...reports];
  const report = { ...nextReports[index] };
  const updatedAt = new Date().toISOString();
  report.status = nextStatus;
  report.timeline = buildUpdatedTimeline(report.timeline, nextStatus, updatedAt);
  report.updatedAt = updatedAt;
  nextReports[index] = report;
  saveLocalReports(nextReports);
  return report;
}

export { sanitizeUser, normalizeEmail };
