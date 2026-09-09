// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};
var STUDENT_SESSION_COOKIE = "campusscope_student_session";
var STUDENT_SESSION_MAX_AGE_MS = 1e3 * 60 * 60 * 24 * 30;

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { and, desc, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// shared/reportSeverity.ts
function classifyReportSeverity(issueType, description = "") {
  const text2 = `${issueType} ${description}`.toLowerCase();
  if (/safety|security|assault|harassment|fire|smoke|gas leak|medical|injury|emergency|locked out|unsafe|threat/.test(text2)) {
    return "CRITICAL";
  }
  if (/water|leak|flood|electrical|electric|light|power|lift|elevator|door|access|broken|urgent|outage/.test(text2)) {
    return "HIGH";
  }
  if (/clean|housekeeping|hygiene|mess|food|pest|internet|wifi|network|noise|temperature|fan|air condition|maintenance/.test(text2)) {
    return "MEDIUM";
  }
  return "LOW";
}

// server/_core/llm.ts
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var resolveApiUrl = () => ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0 ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions` : "https://forge.manus.im/v1/chat/completions";
var assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
var RETRY_MAX_RETRIES = 4;
var RETRY_BASE_DELAY_MS = 500;
var RETRY_MAX_DELAY_MS = 3e4;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var parseRetryAfter = (value) => {
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
  const at = Date.parse(value);
  return Number.isNaN(at) ? void 0 : Math.max(0, at - Date.now());
};
var computeBackoffDelay = (attempt, retryAfterMs) => {
  const cap = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  const jittered = cap / 2 + Math.random() * (cap / 2);
  return Math.min(Math.max(jittered, retryAfterMs ?? 0), RETRY_MAX_DELAY_MS);
};
var fetchWithBackoff = async (url, init) => {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === RETRY_MAX_RETRIES) {
        return response;
      }
      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after")
      );
      try {
        await response.body?.cancel();
      } catch {
      }
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after status ${response.status}`
      );
      await sleep(computeBackoffDelay(attempt, retryAfterMs));
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_RETRIES) throw error;
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after network error`
      );
      await sleep(computeBackoffDelay(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM request failed after exhausting retries");
};
async function invokeLLM(params) {
  assertApiKey();
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    model,
    thinking,
    reasoning,
    maxTokens,
    max_tokens
  } = params;
  const payload = {
    messages: messages.map(normalizeMessage)
  };
  if (model) {
    payload.model = model;
  }
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  const resolvedMaxTokens = max_tokens ?? maxTokens;
  if (typeof resolvedMaxTokens === "number") {
    payload.max_tokens = resolvedMaxTokens;
  }
  if (thinking) {
    payload.thinking = thinking;
  }
  if (reasoning) {
    payload.reasoning = reasoning;
  }
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetchWithBackoff(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return await response.json();
}

// server/aiPriority.ts
var AI_PRIORITY_RANK = { LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 };
var fallbackReason = {
  LOW: "Routine campus issue with limited immediate risk.",
  MEDIUM: "Service disruption that should be handled through the normal operations queue.",
  HIGH: "Significant disruption or repeated campus impact that deserves prompt attention.",
  CRITICAL: "Immediate safety, access, health, or infrastructure risk requires urgent attention."
};
function normalizeAiPriority(value, issueType, description) {
  const fallbackSeverity = classifyReportSeverity(issueType, description);
  if (!value || typeof value !== "object") return { severity: fallbackSeverity, priorityScore: AI_PRIORITY_RANK[fallbackSeverity], reason: fallbackReason[fallbackSeverity] };
  const candidate = value;
  const severity = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(candidate.severity)) ? String(candidate.severity) : fallbackSeverity;
  const score = Number(candidate.priorityScore);
  const priorityScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : AI_PRIORITY_RANK[severity];
  const reason = typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim().slice(0, 500) : fallbackReason[severity];
  return { severity, priorityScore, reason };
}
function persistedPriorityFields(priority) {
  return { aiSeverity: priority.severity, aiPriorityScore: priority.priorityScore, aiPriorityReason: priority.reason };
}
async function classifyReportWithAI(issueType, description) {
  const fallback = normalizeAiPriority(void 0, issueType, description);
  try {
    const response = await invokeLLM({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "You classify genuine student campus complaints for an operations priority queue. Return JSON only. CRITICAL means immediate safety, health, access/egress, security, or major infrastructure risk. HIGH means significant disruption or broad impact. MEDIUM means a meaningful service issue without immediate danger. LOW means routine or limited impact. Score from 0 to 100, and explain the decision in one concise sentence. Do not invent facts." },
        { role: "user", content: `Issue category: ${issueType}
Student complaint: ${description}` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "campus_complaint_priority",
          strict: true,
          schema: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
              priorityScore: { type: "integer", minimum: 0, maximum: 100 },
              reason: { type: "string", minLength: 1, maxLength: 500 }
            },
            required: ["severity", "priorityScore", "reason"],
            additionalProperties: false
          }
        }
      }
    });
    const content = response.choices[0]?.message?.content;
    const text2 = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text || "").join("") : "";
    return normalizeAiPriority(JSON.parse(text2), issueType, description);
  } catch (error) {
    console.warn("[AI priority] Falling back to local classification:", error);
    return fallback;
  }
}

// drizzle/schema.ts
import { boolean, double, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var adminAccounts = mysqlTable("admin_accounts", {
  id: int("id").autoincrement().primaryKey(),
  adminId: varchar("adminId", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  name: text("name").notNull(),
  employeeId: varchar("employeeId", { length: 64 }),
  email: varchar("email", { length: 320 }),
  bio: varchar("bio", { length: 500 }).notNull().default("Keeping campus operations moving."),
  position: varchar("position", { length: 120 }).notNull().default("Operations lead"),
  profileImageUrl: text("profileImageUrl"),
  theme: mysqlEnum("theme", ["dark", "light"]).notNull().default("dark"),
  readingMode: int("readingMode").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var students = mysqlTable("students", {
  id: int("id").autoincrement().primaryKey(),
  registrationNumber: varchar("registrationNumber", { length: 32 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  name: varchar("name", { length: 160 }),
  course: varchar("course", { length: 120 }),
  roomNumber: varchar("roomNumber", { length: 32 }),
  roomType: varchar("roomType", { length: 64 }),
  isHostelRepresentative: boolean("isHostelRepresentative").default(false).notNull(),
  representativeRole: mysqlEnum("representativeRole", ["none", "event", "mess", "sports", "discipline", "maintenance"]).default("none").notNull(),
  profilePhotoUrl: varchar("profilePhotoUrl", { length: 512 }),
  locationTrackingEnabled: boolean("locationTrackingEnabled").default(false).notNull(),
  lastLatitude: double("lastLatitude"),
  lastLongitude: double("lastLongitude"),
  lastLocationAt: timestamp("lastLocationAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var studentSessions = mysqlTable("student_sessions", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull().references(() => students.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var employees = mysqlTable("employees", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  employeeId: varchar("employeeId", { length: 64 }).notNull().unique(),
  department: varchar("department", { length: 120 }).notNull().default("Facilities"),
  phone: varchar("phone", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var reports = mysqlTable("reports", {
  id: int("id").autoincrement().primaryKey(),
  studentId: int("studentId").notNull().references(() => students.id, { onDelete: "cascade" }),
  issueType: varchar("issueType", { length: 120 }).notNull(),
  description: text("description").notNull(),
  block: varchar("block", { length: 16 }).notNull(),
  floor: varchar("floor", { length: 32 }).notNull(),
  messName: varchar("messName", { length: 120 }),
  messCategory: varchar("messCategory", { length: 64 }),
  messIssueType: varchar("messIssueType", { length: 120 }),
  evidenceUrl: varchar("evidenceUrl", { length: 512 }),
  latitude: double("latitude"),
  longitude: double("longitude"),
  locationCapturedAt: timestamp("locationCapturedAt"),
  status: mysqlEnum("status", ["submitted", "reviewed", "assigned", "in_progress", "completed"]).default("submitted").notNull(),
  aiSeverity: mysqlEnum("aiSeverity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  aiPriorityScore: int("aiPriorityScore"),
  aiPriorityReason: varchar("aiPriorityReason", { length: 500 }),
  employeeId: int("employeeId").references(() => employees.id, { onDelete: "set null" }),
  workerName: varchar("workerName", { length: 120 }),
  reviewedAt: timestamp("reviewedAt"),
  assignedAt: timestamp("assignedAt"),
  completedAt: timestamp("completedAt"),
  dedupeKey: varchar("dedupeKey", { length: 128 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  studentIndex: index("reports_studentId_idx").on(table.studentId),
  dedupeIndex: uniqueIndex("reports_student_dedupe_idx").on(table.studentId, table.dedupeKey)
}));
var feedback = mysqlTable("feedback", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull().references(() => reports.id, { onDelete: "cascade" }),
  studentId: int("studentId").notNull().references(() => students.id, { onDelete: "cascade" }),
  rating: int("rating"),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  viewedAt: timestamp("viewedAt"),
  expiresAt: timestamp("expiresAt")
}, (table) => ({
  reportStudentIndex: uniqueIndex("feedback_report_student_idx").on(table.reportId, table.studentId),
  expiryIndex: index("feedback_expiresAt_idx").on(table.expiresAt)
}));
var notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  recipientType: mysqlEnum("recipientType", ["student", "admin"]).notNull(),
  recipientId: int("recipientId").notNull(),
  kind: varchar("kind", { length: 64 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  reportId: int("reportId").references(() => reports.id, { onDelete: "cascade" }),
  isRead: boolean("isRead").notNull().default(false),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  recipientIndex: index("notifications_recipient_idx").on(table.recipientType, table.recipientId, table.createdAt),
  reportIndex: index("notifications_report_idx").on(table.reportId)
}));

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
    }
  }
  return _db;
}
async function upsertUser(user) {
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, role: user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"), lastSignedIn: /* @__PURE__ */ new Date() };
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: { name: values.name, email: values.email, loginMethod: values.loginMethod, role: values.role, lastSignedIn: values.lastSignedIn } });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
}
async function getStudentByRegistrationNumber(registrationNumber) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(students).where(eq(students.registrationNumber, registrationNumber)).limit(1))[0];
}
async function getStudentById(id) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(students).where(eq(students.id, id)).limit(1))[0];
}
async function createStudent(input) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(students).values(input);
  return getStudentByRegistrationNumber(input.registrationNumber);
}
async function getStudentBySessionHash(tokenHash) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select({ student: students }).from(studentSessions).innerJoin(students, eq(studentSessions.studentId, students.id)).where(and(eq(studentSessions.tokenHash, tokenHash), gt(studentSessions.expiresAt, /* @__PURE__ */ new Date()))).limit(1))[0]?.student;
}
async function createStudentSession(studentId, tokenHash, expiresAt) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(studentSessions).values({ studentId, tokenHash, expiresAt });
}
async function deleteStudentSession(tokenHash) {
  const db = await getDb();
  if (db) await db.delete(studentSessions).where(eq(studentSessions.tokenHash, tokenHash));
}
async function updateStudentProfile(id, input) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(students).set(input).where(eq(students.id, id));
  return getStudentById(id);
}
async function updateStudentLocation(id, input) {
  return updateStudentProfile(id, { lastLatitude: input.latitude, lastLongitude: input.longitude, lastLocationAt: /* @__PURE__ */ new Date(), locationTrackingEnabled: true });
}
async function findDuplicateReport(studentId, dedupeKey) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(reports).where(and(eq(reports.studentId, studentId), eq(reports.dedupeKey, dedupeKey), ne(reports.status, "completed"))).limit(1))[0];
}
async function createReport(input) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(reports).values(input);
  return (await db.select().from(reports).where(and(eq(reports.studentId, input.studentId), eq(reports.dedupeKey, input.dedupeKey))).orderBy(desc(reports.createdAt)).limit(1))[0];
}
async function getReportById(id) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(reports).where(eq(reports.id, id)).limit(1))[0];
}
async function getReportsByStudent(studentId) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: reports.id,
    studentId: reports.studentId,
    issueType: reports.issueType,
    description: reports.description,
    block: reports.block,
    floor: reports.floor,
    messName: reports.messName,
    messCategory: reports.messCategory,
    messIssueType: reports.messIssueType,
    evidenceUrl: reports.evidenceUrl,
    latitude: reports.latitude,
    longitude: reports.longitude,
    status: reports.status,
    employeeId: reports.employeeId,
    workerName: reports.workerName,
    reviewedAt: reports.reviewedAt,
    assignedAt: reports.assignedAt,
    completedAt: reports.completedAt,
    createdAt: reports.createdAt,
    updatedAt: reports.updatedAt,
    feedback: feedback.message,
    feedbackRating: feedback.rating,
    feedbackCreatedAt: feedback.createdAt
  }).from(reports).leftJoin(feedback, eq(feedback.reportId, reports.id)).where(eq(reports.studentId, studentId)).orderBy(desc(reports.createdAt));
}
async function updateReportStatus(reportId, status, employeeId) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const now = /* @__PURE__ */ new Date();
  const values = { status };
  if (status === "reviewed") values.reviewedAt = now;
  if (status === "assigned" || status === "in_progress") {
    values.employeeId = employeeId ?? null;
    values.assignedAt = now;
    values.workerName = employeeId ? (await getEmployeeById(employeeId))?.name ?? null : null;
  }
  if (status === "completed") values.completedAt = now;
  await db.update(reports).set(values).where(eq(reports.id, reportId));
  return getReportById(reportId);
}
async function markReportViewed(reportId) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(reports).set({ status: "reviewed", reviewedAt: /* @__PURE__ */ new Date() }).where(and(eq(reports.id, reportId), eq(reports.status, "submitted")));
  return getReportById(reportId);
}
async function addReportFeedback(studentId, reportId, message, rating) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(feedback).values({ reportId, studentId, message, rating: rating ?? null }).onDuplicateKeyUpdate({ set: { message, rating: rating ?? null } });
  return (await db.select().from(feedback).where(and(eq(feedback.reportId, reportId), eq(feedback.studentId, studentId))).limit(1))[0];
}
async function getAdminByAdminId(adminId) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(adminAccounts).where(eq(adminAccounts.adminId, adminId)).limit(1))[0];
}
async function getAdminById(id) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(adminAccounts).where(eq(adminAccounts.id, id)).limit(1))[0];
}
async function listAdminAccounts() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: adminAccounts.id, name: adminAccounts.name }).from(adminAccounts);
}
async function createAdminAccount(input) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(adminAccounts).values(input);
  return getAdminByAdminId(input.adminId);
}
async function updateAdminAccount(id, input) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(adminAccounts).set(input).where(eq(adminAccounts.id, id));
  return getAdminById(id);
}
async function touchAdminSignIn(id) {
  return updateAdminAccount(id, { lastSignedIn: /* @__PURE__ */ new Date() });
}
async function listEmployees() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: employees.id, name: employees.name, employeeId: employees.employeeId, department: employees.department, phone: employees.phone, createdAt: employees.createdAt, activeComplaintCount: sql`(select count(*) from reports where reports.employeeId = employees.id and reports.status <> 'completed')` }).from(employees).orderBy(employees.name);
}
async function getEmployeeById(id) {
  const db = await getDb();
  if (!db) return void 0;
  return (await db.select().from(employees).where(eq(employees.id, id)).limit(1))[0];
}
async function createEmployee(input) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(employees).values(input);
  return listEmployees();
}
function assertEmployeeCanBeRemoved(activeComplaintCount) {
  if (activeComplaintCount > 0) throw new Error("employee is managing a complaint");
}
async function deleteEmployee(id) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const active = await db.select({ id: reports.id }).from(reports).where(and(eq(reports.employeeId, id), ne(reports.status, "completed"))).limit(1);
  assertEmployeeCanBeRemoved(active.length);
  await db.delete(employees).where(eq(employees.id, id));
  return listEmployees();
}
function addReportSeverity(rows) {
  return rows.map((entry) => {
    const severity = entry.report.aiSeverity || classifyReportSeverity(entry.report.issueType, entry.report.description);
    const normalizedSeverity = severity === "LOW" || severity === "MEDIUM" || severity === "HIGH" || severity === "CRITICAL" ? severity : "LOW";
    return { ...entry, report: { ...entry.report, severity: normalizedSeverity, priorityScore: entry.report.aiPriorityScore ?? AI_PRIORITY_RANK[normalizedSeverity], priorityReason: entry.report.aiPriorityReason ?? null } };
  });
}
var FEEDBACK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1e3;
function feedbackExpiryFromFirstView(viewedAt) {
  return new Date(viewedAt.getTime() + FEEDBACK_EXPIRY_MS);
}
async function markFeedbackViewed(feedbackId) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const now = /* @__PURE__ */ new Date();
  const expiry = feedbackExpiryFromFirstView(now);
  await db.update(feedback).set({ viewedAt: now, expiresAt: expiry }).where(and(eq(feedback.id, feedbackId), sql`${feedback.viewedAt} IS NULL`, or(sql`${feedback.expiresAt} IS NULL`, gt(feedback.expiresAt, now))));
  return (await db.select().from(feedback).where(and(eq(feedback.id, feedbackId), or(sql`${feedback.expiresAt} IS NULL`, gt(feedback.expiresAt, now)))).limit(1))[0];
}
async function listFeedback() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ feedback, report: reports, student: students }).from(feedback).innerJoin(reports, eq(feedback.reportId, reports.id)).innerJoin(students, eq(feedback.studentId, students.id)).where(or(sql`${feedback.expiresAt} IS NULL`, gt(feedback.expiresAt, /* @__PURE__ */ new Date()))).orderBy(desc(feedback.createdAt));
}
async function deleteExpiredFeedback(now = /* @__PURE__ */ new Date()) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.delete(feedback).where(and(sql`${feedback.expiresAt} IS NOT NULL`, lt(feedback.expiresAt, now)));
  return Number(result.rowsAffected ?? 0);
}
async function createNotification(input) {
  const db = await getDb();
  if (!db) return void 0;
  await db.insert(notifications).values(input);
  return (await db.select().from(notifications).where(and(eq(notifications.recipientType, input.recipientType), eq(notifications.recipientId, input.recipientId))).orderBy(desc(notifications.createdAt)).limit(1))[0];
}
function notificationSelect(db, recipientType, recipientId) {
  return db.select({
    id: notifications.id,
    recipientType: notifications.recipientType,
    recipientId: notifications.recipientId,
    kind: notifications.kind,
    title: notifications.title,
    message: notifications.message,
    reportId: notifications.reportId,
    reportNumber: reports.id,
    reportIssueType: reports.issueType,
    reportBlock: reports.block,
    isRead: notifications.isRead,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt
  }).from(notifications).leftJoin(reports, eq(notifications.reportId, reports.id)).where(and(eq(notifications.recipientType, recipientType), eq(notifications.recipientId, recipientId))).orderBy(desc(notifications.createdAt));
}
async function getStudentNotifications(studentId) {
  const db = await getDb();
  if (!db) return [];
  return notificationSelect(db, "student", studentId);
}
async function getAdminNotifications(adminId) {
  const db = await getDb();
  if (!db) return [];
  return notificationSelect(db, "admin", adminId);
}
function notificationReadPatch(readAt = /* @__PURE__ */ new Date()) {
  return { isRead: true, readAt };
}
async function markNotificationRead(id, recipientType, recipientId) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set(notificationReadPatch()).where(and(eq(notifications.id, id), eq(notifications.recipientType, recipientType), eq(notifications.recipientId, recipientId)));
}
async function markAllNotificationsRead(recipientType, recipientId) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set(notificationReadPatch()).where(and(eq(notifications.recipientType, recipientType), eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)));
}
async function listLoggedAdminReports() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ report: reports, student: students, employee: employees }).from(reports).innerJoin(students, eq(reports.studentId, students.id)).leftJoin(employees, eq(reports.employeeId, employees.id)).where(eq(reports.status, "completed")).orderBy(desc(reports.completedAt), desc(reports.createdAt));
  return addReportSeverity(rows);
}
async function listActiveAdminReports() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ report: reports, student: students, employee: employees }).from(reports).innerJoin(students, eq(reports.studentId, students.id)).leftJoin(employees, eq(reports.employeeId, employees.id)).where(ne(reports.status, "completed")).orderBy(desc(reports.createdAt));
  return addReportSeverity(rows);
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader2) {
    if (!cookieHeader2) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader2);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret2 = ENV.cookieSecret;
    return new TextEncoder().encode(secret2);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z2 } from "zod";

// shared/campus.ts
var ROOM_TYPES = [
  "2-AC (Veg Mess)",
  "2-AC (Non-Veg Mess)",
  "2-AC (Special Mess)",
  "3-AC (Veg Mess)",
  "3-AC (Non-Veg Mess)",
  "3-AC (Special Mess)",
  "4-AC (Veg Mess)",
  "4-AC (Non-Veg Mess)",
  "4-AC (Special Mess)",
  "2-Non AC (Veg Mess)",
  "2-Non AC (Non-Veg Mess)",
  "2-Non AC (Special Mess)",
  "3-Non AC (Veg Mess)",
  "3-Non AC (Non-Veg Mess)",
  "3-Non AC (Special Mess)",
  "4-Non AC (Veg Mess)",
  "4-Non AC (Non-Veg Mess)",
  "4-Non AC (Special Mess)"
];
var FLOORS = [
  "Ground floor",
  ...Array.from({ length: 17 }, (_, index2) => {
    const floor = index2 + 1;
    const suffix = floor === 1 ? "st" : floor === 2 ? "nd" : floor === 3 ? "rd" : "th";
    return `${floor}${suffix} floor`;
  })
];
var ISSUE_CATALOG = [
  { value: "Drinking water", label: "Drinking water", group: "Water & plumbing", hint: "Coolers, taps, filters, or supply" },
  { value: "Washing water", label: "Washing water", group: "Water & plumbing", hint: "Wash basins, utility taps, or supply" },
  { value: "Water leakage / plumbing", label: "Water leakage / plumbing", group: "Water & plumbing", hint: "Leaks, drainage, or pipework" },
  { value: "AC / fan not working", label: "AC / fan not working", group: "Comfort & power", hint: "Room cooling or ventilation" },
  { value: "Light flickering / power", label: "Light flickering / power", group: "Comfort & power", hint: "Lights, switches, sockets, or power" },
  { value: "Broken toilet / washroom", label: "Broken toilet / washroom", group: "Sanitation", hint: "Toilet, flush, basin, or washroom fixture" },
  { value: "Wi-Fi / connectivity", label: "Wi-Fi / connectivity", group: "Digital access", hint: "Campus network or weak signal" },
  { value: "Cleanliness / waste", label: "Cleanliness / waste", group: "Hygiene", hint: "Unclean room, corridor, bin, or spill" },
  { value: "Overcrowding / access", label: "Overcrowding / access", group: "Shared spaces", hint: "Blocked access or capacity concern" },
  { value: "Furniture / room maintenance", label: "Furniture / room maintenance", group: "Room upkeep", hint: "Bed, desk, door, lock, or fixture" },
  { value: "Pest control", label: "Pest control", group: "Hygiene", hint: "Insects, rodents, or infestation" },
  { value: "Mess issue", label: "Mess issue", group: "Food & dining", hint: "Report a specific mess or food concern" },
  { value: "Other maintenance", label: "Other maintenance", group: "Other", hint: "Anything else the campus team should see" },
  { value: "Road / pathway damage", label: "Road / pathway damage", group: "Campus grounds", hint: "Potholes, broken paving, or unsafe walkways" },
  { value: "Campus lighting", label: "Campus lighting", group: "Campus grounds", hint: "Dark paths, parking areas, or outdoor lights" },
  { value: "Lift / elevator issue", label: "Lift / elevator issue", group: "Campus access", hint: "Lift outage, doors, alarms, or access" },
  { value: "Security / safety concern", label: "Security / safety concern", group: "Campus safety", hint: "Unsafe conditions, access control, or security concern" },
  { value: "Classroom / lab equipment", label: "Classroom / lab equipment", group: "Academic spaces", hint: "Projector, desk, lab equipment, or classroom fixture" },
  { value: "Library / study space", label: "Library / study space", group: "Academic spaces", hint: "Seating, noise, lighting, or facility access" },
  { value: "Sports facility", label: "Sports facility", group: "Campus facilities", hint: "Court, field, gym, or sports equipment" },
  { value: "Parking / transport", label: "Parking / transport", group: "Campus facilities", hint: "Parking, shuttle, traffic flow, or cycle stand" },
  { value: "Accessibility support", label: "Accessibility support", group: "Campus access", hint: "Ramps, accessible routes, lifts, or wayfinding" },
  { value: "Room lock / key", label: "Room lock / key", group: "Hostel rooms", hint: "Door lock, key, latch, or room access" },
  { value: "Bed / mattress / furniture", label: "Bed / mattress / furniture", group: "Hostel rooms", hint: "Bed, mattress, cupboard, desk, or chair" },
  { value: "Hot water / bathroom", label: "Hot water / bathroom", group: "Hostel facilities", hint: "Hot water, shower, drainage, or bathroom fixture" },
  { value: "Laundry facility", label: "Laundry facility", group: "Hostel facilities", hint: "Washing machines, drying space, or laundry service" },
  { value: "Hostel common room", label: "Hostel common room", group: "Hostel facilities", hint: "Common room, recreation area, or shared equipment" },
  { value: "Hostel internet", label: "Hostel internet", group: "Hostel facilities", hint: "Weak Wi-Fi or connectivity inside the hostel" }
];
var REPRESENTATIVE_ROLES = ["none", "event", "mess", "sports", "discipline", "maintenance"];
var ISSUE_VALUES = ISSUE_CATALOG.map((item) => item.value);

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";

// server/accountAuth.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { parse } from "cookie";
var ACCOUNT_SESSION_COOKIE = "campus_scope_session";
var DEMO_ADMIN_PASSWORD = "CampusScope@Admin2026";
var SESSION_TTL_MS = 1e3 * 60 * 60 * 24 * 30;
function secret() {
  return ENV.cookieSecret || "campus-scope-local-development-secret";
}
function hashAdminPassword(password) {
  return createHmac("sha256", secret()).update(password).digest("hex");
}
function isValidDemoPassword(password) {
  return password === DEMO_ADMIN_PASSWORD;
}
function createAccountSession(accountId) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${accountId}.${expiresAt}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}
function getAccountIdFromSession(req) {
  const raw = parse(req.headers.cookie ?? "")[ACCOUNT_SESSION_COOKIE];
  if (!raw) return null;
  const [accountIdText, expiresAtText, signature] = raw.split(".");
  const accountId = Number(accountIdText);
  const expiresAt = Number(expiresAtText);
  if (!Number.isInteger(accountId) || !expiresAt || !signature || expiresAt < Date.now()) return null;
  const payload = `${accountId}.${expiresAt}`;
  const expected = createHmac("sha256", secret()).update(payload).digest("hex");
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  return accountId;
}
function cookieHeader(value, maxAge) {
  return `${ACCOUNT_SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${ENV.isProduction ? "; Secure" : ""}`;
}
function appendCookie(res, value) {
  if (typeof res.append === "function") res.append("Set-Cookie", value);
  else if (typeof res.setHeader === "function") res.setHeader("Set-Cookie", value);
}
function setAccountSession(res, accountId) {
  appendCookie(res, cookieHeader(createAccountSession(accountId), SESSION_TTL_MS / 1e3));
}
function clearAccountSession(res) {
  appendCookie(res, cookieHeader("", 0));
}

// server/_core/trpc.ts
var t = initTRPC.context().create({ transformer: superjson });
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
var requireStudent = t.middleware(async ({ ctx, next }) => {
  if (!ctx.student) throw new TRPCError2({ code: "UNAUTHORIZED", message: "Student sign-in required." });
  return next({ ctx: { ...ctx, student: ctx.student } });
});
var requireAdmin = t.middleware(async ({ ctx, next }) => {
  const accountId = getAccountIdFromSession(ctx.req);
  const account = accountId ? await getAdminById(accountId) : null;
  if ((!ctx.user || ctx.user.role !== "admin") && !account) throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  return next({ ctx });
});
var protectedProcedure = t.procedure.use(requireUser);
var studentProcedure = t.procedure.use(requireStudent);
var adminProcedure = t.procedure.use(requireAdmin);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/studentAuth.ts
import { createHash, randomBytes, scryptSync, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var STUDENT_SESSION_MAX_AGE_MS2 = 1e3 * 60 * 60 * 24 * 14;
function normalizeRegistrationNumber(value) {
  return value.trim().toUpperCase();
}
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  const [salt, storedKey] = storedHash.split(":");
  if (!salt || !storedKey) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(storedKey, "hex");
  return expected.length === derived.length && timingSafeEqual2(expected, derived);
}
function createSessionToken() {
  return randomBytes(32).toString("base64url");
}
function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function buildDedupeKey(input) {
  return createHash("sha256").update(JSON.stringify({
    issueType: input.issueType,
    description: input.description.trim().replace(/\s+/g, " ").toLowerCase(),
    block: input.block,
    floor: input.floor,
    messName: input.messName ?? "",
    messCategory: input.messCategory ?? "",
    messIssueType: input.messIssueType ?? ""
  })).digest("hex");
}

// server/storage.ts
function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }
  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function appendHashSuffix(relKey) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` }
  });
  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }
  const { url: s3Url } = await presignResp.json();
  if (!s3Url) throw new Error("Forge returned empty presign URL");
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob
  });
  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }
  return { key, url: `/manus-storage/${key}` };
}

// server/routers.ts
var registrationSchema = z2.string().trim().min(4).max(32).transform(normalizeRegistrationNumber);
var passwordSchema = z2.string().min(8).max(128);
var studentCookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: STUDENT_SESSION_MAX_AGE_MS / 1e3 };
function readCookie(value, key) {
  return value?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${key}=`))?.split("=").slice(1).join("=");
}
function setStudentCookie(res, token) {
  if (res.cookie) res.cookie(STUDENT_SESSION_COOKIE, token, studentCookieOptions);
  else res.setHeader("Set-Cookie", `${STUDENT_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${studentCookieOptions.maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
function clearStudentCookie(res) {
  if (res.clearCookie) res.clearCookie(STUDENT_SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  else res.setHeader("Set-Cookie", `${STUDENT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
function accountFrom(ctx) {
  const id = getAccountIdFromSession(ctx.req);
  return id ? getAdminById(id) : void 0;
}
function outputAccount(account) {
  return account && { id: account.id, adminId: account.adminId, name: account.name, email: account.email, bio: account.bio, position: account.position, profileImageUrl: account.profileImageUrl, theme: account.theme, readingMode: Boolean(account.readingMode) };
}
function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n").trim();
  return "";
}
function reportLabel(reportId) {
  return `#${String(reportId).padStart(4, "0")}`;
}
function createMeaningPreservingTranslationMessages(text2) {
  return [{ role: "system", content: "You are a careful campus operations translator. Translate the student\u2019s text into clear, natural English. Detect Hinglish, Tamil-English, code-switching, slang, and other languages. Preserve every factual detail, urgency, uncertainty, tone, quantities, locations, and time references. Do not summarize, embellish, soften, or add information. Return only the translation, with no preface or quotation marks." }, { role: "user", content: text2 }];
}
function buildFeedbackNotificationMessage(studentName, registrationNumber, reportId, feedbackText) {
  return `${studentName || registrationNumber} left feedback on complaint ${reportLabel(reportId)}: \u201C${feedbackText.slice(0, 180)}${feedbackText.length > 180 ? "\u2026" : ""}\u201D`;
}
function buildAssignmentNotificationMessage(adminName, facultyName, reportId, issueType, block, floor) {
  return `${adminName} assigned ${facultyName} to complaint ${reportLabel(reportId)} about \u201C${issueType}\u201D in ${block} Block \xB7 ${floor}.`;
}
function buildResolutionNotificationMessage(adminName, facultyName, reportId, issueType, block) {
  return `${adminName} resolved complaint ${reportLabel(reportId)} about \u201C${issueType}\u201D in ${block} Block${facultyName ? ` after work by ${facultyName}` : ""}. Please check the area and leave feedback if needed.`;
}
async function notifyAllAdmins(input) {
  const admins = await listAdminAccounts();
  await Promise.all(admins.map((admin) => createNotification({ recipientType: "admin", recipientId: admin.id, kind: input.kind, title: input.title, message: input.message, reportId: input.reportId ?? null })));
}
async function notifyStudent(studentId, input) {
  return createNotification({ recipientType: "student", recipientId: studentId, kind: input.kind, title: input.title, message: input.message, reportId: input.reportId ?? null });
}
function decodeAdminProfileImage(dataUrl, mimeHint) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new TRPCError3({ code: "BAD_REQUEST", message: "Profile picture must be a PNG, JPEG, or WebP image." });
  const mimeType = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > 3e6) throw new TRPCError3({ code: "BAD_REQUEST", message: "Profile picture must be smaller than 3 MB." });
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  if (mimeHint && mimeHint !== mimeType) throw new TRPCError3({ code: "BAD_REQUEST", message: "Profile picture type does not match its file content." });
  return { buffer, mimeType, extension };
}
function decodeEvidenceImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new TRPCError3({ code: "BAD_REQUEST", message: "Evidence must be a PNG, JPEG, or WebP image." });
  const mimeType = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > 5e6) throw new TRPCError3({ code: "BAD_REQUEST", message: "Evidence images must be smaller than 5 MB." });
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return { buffer, mimeType, extension };
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.student ?? null),
    session: publicProcedure.query(({ ctx }) => ctx.student ? { role: "student", identity: ctx.student } : ctx.admin ? { role: "admin", identity: ctx.admin } : null),
    register: publicProcedure.input(z2.object({ registrationNumber: registrationSchema, password: passwordSchema, name: z2.string().trim().max(160).optional() })).mutation(async ({ input, ctx }) => {
      if (await getStudentByRegistrationNumber(input.registrationNumber)) throw new TRPCError3({ code: "CONFLICT", message: "That registration number is already registered." });
      const student = await createStudent({ registrationNumber: input.registrationNumber, passwordHash: hashPassword(input.password), name: input.name || null });
      if (!student) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Unable to create the student account." });
      const token = createSessionToken();
      await createStudentSession(student.id, hashSessionToken(token), new Date(Date.now() + STUDENT_SESSION_MAX_AGE_MS));
      setStudentCookie(ctx.res, token);
      return student;
    }),
    login: publicProcedure.input(z2.object({ registrationNumber: registrationSchema, password: passwordSchema })).mutation(async ({ input, ctx }) => {
      const student = await getStudentByRegistrationNumber(input.registrationNumber);
      if (!student || !verifyPassword(input.password, student.passwordHash)) throw new TRPCError3({ code: "UNAUTHORIZED", message: "Registration number or password is incorrect." });
      const token = createSessionToken();
      await createStudentSession(student.id, hashSessionToken(token), new Date(Date.now() + STUDENT_SESSION_MAX_AGE_MS));
      setStudentCookie(ctx.res, token);
      return student;
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const token = readCookie(ctx.req.headers.cookie, STUDENT_SESSION_COOKIE);
      if (token) {
        await deleteStudentSession(hashSessionToken(decodeURIComponent(token)));
        clearStudentCookie(ctx.res);
      }
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      const hasAccountSession = Boolean(readCookie(ctx.req.headers.cookie, "campus_scope_session"));
      if (hasAccountSession) clearAccountSession(ctx.res);
      return { success: true };
    })
  }),
  student: router({
    profile: studentProcedure.query(({ ctx }) => ctx.student),
    updateProfile: studentProcedure.input(z2.object({ name: z2.string().trim().min(2).max(160).optional(), course: z2.string().trim().max(120).nullable().optional(), roomNumber: z2.string().trim().max(32).nullable().optional(), roomType: z2.enum(ROOM_TYPES).nullable().optional(), isHostelRepresentative: z2.boolean().optional(), representativeRole: z2.enum(REPRESENTATIVE_ROLES).optional(), profilePhotoUrl: z2.string().max(512).nullable().optional(), locationTrackingEnabled: z2.boolean().optional() })).mutation(({ input, ctx }) => updateStudentProfile(ctx.student.id, { ...input, representativeRole: input.isHostelRepresentative ? input.representativeRole ?? "none" : input.isHostelRepresentative === false ? "none" : input.representativeRole })),
    updateLocation: studentProcedure.input(z2.object({ latitude: z2.number(), longitude: z2.number() })).mutation(({ input, ctx }) => updateStudentLocation(ctx.student.id, input)),
    uploadProfilePhoto: studentProcedure.input(z2.object({ dataUrl: z2.string() })).mutation(async ({ input, ctx }) => {
      const image = decodeEvidenceImage(input.dataUrl);
      const uploaded = await storagePut(`student-profiles/${ctx.student.id}/profile.${image.extension}`, image.buffer, image.mimeType);
      return updateStudentProfile(ctx.student.id, { profilePhotoUrl: uploaded.url });
    }),
    uploadReportEvidence: studentProcedure.input(z2.object({ dataUrl: z2.string() })).mutation(async ({ input, ctx }) => {
      const image = decodeEvidenceImage(input.dataUrl);
      const uploaded = await storagePut(`report-evidence/${ctx.student.id}/${Date.now()}.${image.extension}`, image.buffer, image.mimeType);
      return { url: uploaded.url };
    }),
    reports: studentProcedure.query(({ ctx }) => getReportsByStudent(ctx.student.id)),
    notifications: studentProcedure.query(({ ctx }) => getStudentNotifications(ctx.student.id)),
    markNotificationRead: studentProcedure.input(z2.object({ notificationId: z2.number() })).mutation(({ input, ctx }) => markNotificationRead(input.notificationId, "student", ctx.student.id)),
    markAllNotificationsRead: studentProcedure.mutation(({ ctx }) => markAllNotificationsRead("student", ctx.student.id)),
    createReport: studentProcedure.input(z2.object({ issueType: z2.string().min(2), description: z2.string().trim().min(10).max(5e3), block: z2.string(), floor: z2.string(), messName: z2.string().nullable().optional(), messCategory: z2.string().nullable().optional(), messIssueType: z2.string().nullable().optional(), evidenceUrl: z2.string().nullable().optional(), latitude: z2.number().nullable().optional(), longitude: z2.number().nullable().optional() })).mutation(async ({ input, ctx }) => {
      const key = buildDedupeKey(input);
      if (await findDuplicateReport(ctx.student.id, key)) throw new TRPCError3({ code: "CONFLICT", message: "You already submitted this same unresolved issue for this location." });
      const aiPriority = await classifyReportWithAI(input.issueType, input.description);
      const report = await createReport({ ...input, ...persistedPriorityFields(aiPriority), studentId: ctx.student.id, dedupeKey: key, status: "submitted", locationCapturedAt: input.latitude != null && input.longitude != null ? /* @__PURE__ */ new Date() : null });
      if (report) await notifyAllAdmins({ kind: "new_report", title: "New complaint received", message: `${ctx.student.name || ctx.student.registrationNumber} submitted \u201C${input.issueType}\u201D in ${input.block} Block \xB7 ${input.floor}. Review complaint ${reportLabel(report.id)}.`, reportId: report.id });
      return report;
    }),
    addFeedback: studentProcedure.input(z2.object({ reportId: z2.number(), feedback: z2.string().trim().min(3).max(1e3) })).mutation(async ({ input, ctx }) => {
      const report = await getReportById(input.reportId);
      if (!report || report.studentId !== ctx.student.id) throw new TRPCError3({ code: "NOT_FOUND", message: "That complaint could not be found." });
      if (report.status !== "completed") throw new TRPCError3({ code: "BAD_REQUEST", message: "Feedback is available after a complaint is resolved." });
      const saved = await addReportFeedback(ctx.student.id, input.reportId, input.feedback);
      await notifyAllAdmins({ kind: "feedback", title: "Student feedback received", message: buildFeedbackNotificationMessage(ctx.student.name || "", ctx.student.registrationNumber, input.reportId, input.feedback), reportId: input.reportId });
      return saved;
    }),
    guidance: studentProcedure.input(z2.object({ issueType: z2.string(), description: z2.string(), status: z2.string() })).query(({ input }) => ({ guidance: input.status === "completed" ? "The team marked this completed. Check the area and leave feedback if anything still needs attention." : "Your report is in the campus review queue. Keep the area accessible if it is safe to do so." }))
  }),
  admin: router({
    me: publicProcedure.query(async ({ ctx }) => outputAccount(await accountFrom(ctx)) ?? null),
    login: publicProcedure.input(z2.object({ adminId: z2.string().trim().min(3), password: z2.string().optional() })).mutation(async ({ input, ctx }) => {
      const account = await getAdminByAdminId(input.adminId);
      if (!account) throw new TRPCError3({ code: "NOT_FOUND", message: "No admin account was found for that ID." });
      if (input.password && hashAdminPassword(input.password) !== account.passwordHash) throw new TRPCError3({ code: "UNAUTHORIZED", message: "Admin ID or password is incorrect." });
      await touchAdminSignIn(account.id);
      setAccountSession(ctx.res, account.id);
      return outputAccount(await getAdminById(account.id));
    }),
    createAccount: publicProcedure.input(z2.object({ adminId: z2.string().trim().min(3).regex(/^[a-zA-Z0-9._-]+$/), name: z2.string().trim().min(2), employeeId: z2.string().trim().min(1).optional(), email: z2.string().trim().email().optional().or(z2.literal("")), password: z2.string().min(8), fixedAdminPassword: z2.string().min(1).optional() })).mutation(async ({ input, ctx }) => {
      if (!isValidDemoPassword(input.fixedAdminPassword ?? input.password)) throw new TRPCError3({ code: "BAD_REQUEST", message: `Use the fixed admin authorization password: ${DEMO_ADMIN_PASSWORD}` });
      if (await getAdminByAdminId(input.adminId)) throw new TRPCError3({ code: "CONFLICT", message: "That admin ID already exists. Try logging in instead." });
      const account = await createAdminAccount({ adminId: input.adminId, employeeId: input.employeeId, passwordHash: hashAdminPassword(input.password), name: input.name, email: input.email || null });
      setAccountSession(ctx.res, account.id);
      return outputAccount(account);
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearAccountSession(ctx.res);
      return { success: true };
    }),
    updateProfile: publicProcedure.input(z2.object({ name: z2.string().min(2), bio: z2.string().max(500), position: z2.string().min(2), profileImageDataUrl: z2.string().max(45e5).optional(), profileImageMimeType: z2.string().optional() })).mutation(async ({ input, ctx }) => {
      const account = await accountFrom(ctx);
      if (!account) throw new TRPCError3({ code: "UNAUTHORIZED" });
      let profileImageUrl;
      if (input.profileImageDataUrl) {
        const image = decodeAdminProfileImage(input.profileImageDataUrl, input.profileImageMimeType);
        const uploaded = await storagePut(`admin-profiles/${account.id}/profile.${image.extension}`, image.buffer, image.mimeType);
        profileImageUrl = uploaded.url;
      }
      return outputAccount(await updateAdminAccount(account.id, { name: input.name, bio: input.bio, position: input.position, ...profileImageUrl ? { profileImageUrl } : {} }));
    }),
    updatePreferences: publicProcedure.input(z2.object({ theme: z2.enum(["dark", "light"]), readingMode: z2.boolean() })).mutation(async ({ input, ctx }) => {
      const account = await accountFrom(ctx);
      if (!account) throw new TRPCError3({ code: "UNAUTHORIZED" });
      return outputAccount(await updateAdminAccount(account.id, { theme: input.theme, readingMode: input.readingMode ? 1 : 0 }));
    }),
    reports: adminProcedure.query(() => listActiveAdminReports()),
    loggedReports: adminProcedure.query(() => listLoggedAdminReports()),
    feedback: adminProcedure.query(() => listFeedback()),
    viewFeedback: adminProcedure.input(z2.object({ feedbackId: z2.number() })).mutation(({ input }) => markFeedbackViewed(input.feedbackId)),
    notifications: adminProcedure.query(async ({ ctx }) => {
      const account = await accountFrom(ctx);
      if (!account) throw new TRPCError3({ code: "UNAUTHORIZED" });
      return getAdminNotifications(account.id);
    }),
    markNotificationRead: adminProcedure.input(z2.object({ notificationId: z2.number() })).mutation(async ({ input, ctx }) => {
      const account = await accountFrom(ctx);
      if (!account) throw new TRPCError3({ code: "UNAUTHORIZED" });
      return markNotificationRead(input.notificationId, "admin", account.id);
    }),
    markAllNotificationsRead: adminProcedure.mutation(async ({ ctx }) => {
      const account = await accountFrom(ctx);
      if (!account) throw new TRPCError3({ code: "UNAUTHORIZED" });
      return markAllNotificationsRead("admin", account.id);
    }),
    translate: adminProcedure.input(z2.object({ text: z2.string().trim().min(1).max(5e3) })).mutation(async ({ input }) => {
      const result = await invokeLLM({ model: "gpt-5-mini", maxTokens: 900, messages: createMeaningPreservingTranslationMessages(input.text) });
      const translation = textFromContent(result.choices[0]?.message?.content);
      if (!translation) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Translation returned no text. Please try again." });
      return { translation };
    }),
    employees: adminProcedure.query(() => listEmployees()),
    addEmployee: adminProcedure.input(z2.object({ name: z2.string().min(2), employeeId: z2.string().min(1), department: z2.string().optional(), phone: z2.string().optional() })).mutation(({ input }) => createEmployee({ ...input, department: input.department ?? "Facilities" })),
    removeEmployee: adminProcedure.input(z2.object({ employeeId: z2.number() })).mutation(async ({ input }) => {
      try {
        return await deleteEmployee(input.employeeId);
      } catch (error) {
        if (String(error).includes("employee is managing a complaint")) throw new TRPCError3({ code: "CONFLICT", message: "employee is managing a complaint" });
        throw error;
      }
    }),
    reviewReport: adminProcedure.input(z2.object({ reportId: z2.number() })).mutation(async ({ input, ctx }) => {
      const account = await accountFrom(ctx);
      const report = await getReportById(input.reportId);
      if (!account || !report) throw new TRPCError3({ code: "NOT_FOUND", message: "Complaint not found." });
      const wasSubmitted = report.status === "submitted";
      const updated = await markReportViewed(input.reportId);
      if (wasSubmitted) await notifyStudent(report.studentId, { kind: "reviewed", title: "Your complaint is being reviewed", message: `${account.name} is reviewing complaint ${reportLabel(report.id)} about \u201C${report.issueType}\u201D in ${report.block} Block.`, reportId: report.id });
      return updated;
    }),
    assignReport: adminProcedure.input(z2.object({ reportId: z2.number(), employeeId: z2.number() })).mutation(async ({ input, ctx }) => {
      const account = await accountFrom(ctx);
      const report = await getReportById(input.reportId);
      const employee = await getEmployeeById(input.employeeId);
      if (!account || !report || !employee) throw new TRPCError3({ code: "NOT_FOUND", message: "Complaint or faculty member not found." });
      const updated = await updateReportStatus(input.reportId, "assigned", input.employeeId);
      await notifyStudent(report.studentId, { kind: "assigned", title: "A faculty member was assigned", message: buildAssignmentNotificationMessage(account.name, employee.name, report.id, report.issueType, report.block, report.floor), reportId: report.id });
      return updated;
    }),
    completeReport: adminProcedure.input(z2.object({ reportId: z2.number() })).mutation(async ({ input, ctx }) => {
      const account = await accountFrom(ctx);
      const report = await getReportById(input.reportId);
      if (!account || !report) throw new TRPCError3({ code: "NOT_FOUND", message: "Complaint not found." });
      const updated = await updateReportStatus(input.reportId, "completed");
      await notifyStudent(report.studentId, { kind: "resolved", title: "Your complaint was resolved", message: buildResolutionNotificationMessage(account.name, report.workerName, report.id, report.issueType, report.block), reportId: report.id });
      return updated;
    })
  })
});

// server/_core/context.ts
function readCookie2(cookieHeader2, key) {
  return cookieHeader2?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${key}=`))?.split("=").slice(1).join("=");
}
async function createContext(opts) {
  let user = null;
  let student = null;
  let admin = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }
  try {
    const token = readCookie2(opts.req.headers.cookie, STUDENT_SESSION_COOKIE);
    if (token) student = await getStudentBySessionHash(hashSessionToken(decodeURIComponent(token))) ?? null;
  } catch {
    student = null;
  }
  try {
    const accountId = getAccountIdFromSession(opts.req);
    if (accountId) admin = await getAdminById(accountId) ?? null;
  } catch {
    admin = null;
  }
  return { req: opts.req, res: opts.res, user, student, admin };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/cleanup.ts
async function cleanupExpiredFeedbackHandler(req, res) {
  const timestamp2 = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only" });
    }
    const deleted = await deleteExpiredFeedback();
    return res.json({ ok: true, deleted, taskUid: user.taskUid, timestamp: timestamp2 });
  } catch (error) {
    return res.status(500).json({
      error: String(error),
      stack: error instanceof Error ? error.stack : void 0,
      context: { url: req.originalUrl, taskUid: req.headers["x-manus-task-uid"] ?? null },
      timestamp: timestamp2
    });
  }
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  app.post("/api/scheduled/cleanup-feedback", cleanupExpiredFeedbackHandler);
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
