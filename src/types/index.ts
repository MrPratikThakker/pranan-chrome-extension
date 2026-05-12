// =============================================================================
// Pranan Companion -- Shared Types
// =============================================================================

// --- Platform Detection ---

export type Platform = 'gmail' | 'slack' | 'linkedin' | 'universal' | 'unknown';

export interface ComposeContext {
  platform: Platform;
  recipientEmail: string | null;
  recipientName: string | null;
  threadId: string | null;
  messageToReplyTo: string | null;
  channelName: string | null;   // Slack
  isDM: boolean;                 // Slack
  selectedText: string | null;   // For rewrite
  composeType?: 'message' | 'post' | 'comment'; // LinkedIn compose variant
  linkedinUrl?: string | null;  // LinkedIn post author profile URL (comment context)
}

// --- API Response Types ---

export interface ContactContext {
  tier: string;
  lastInteraction: string | null;
  communicationDNA: {
    formality: number;
    avgReplyLength: number;
    greetingStyle: string;
    closingStyle: string;
    toneNotes: string | null;
  } | null;
  recentTopics: string[];
  memories: Array<{
    type: string;
    content: string;
    summary: string;
    attributed_to: string;
  }>;
  style: {
    tone: string | null;
    styleNotes: string | null;
    organization: string | null;
    roleTitle: string | null;
    contactName: string | null;
    healthScore: number | null;
    health: string | null;
  };
}

export interface DraftResponse {
  draft: string;
  confidence: number;
  voiceMatch: number;
  alternativeTones: Array<{
    tone: string;
    preview: string;
  }>;
}

export interface RewriteResponse {
  rewritten: string;
  changes: Array<{
    original: string;
    replacement: string;
    reason: string;
  }>;
  voiceMatchScore: number;
}

export interface GrammarCorrection {
  range: { start: number; end: number };
  original: string;
  suggestion: string;
  type: 'grammar' | 'tone' | 'voice';
  reason: string;
}

export interface GrammarResponse {
  corrections: GrammarCorrection[];
  toneFlags: Array<{
    flag: string;
    severity: 'info' | 'warning' | 'error';
    suggestion: string;
  }>;
  overallScore: number;
  suggestions: string[];
}

export interface AuthResponse {
  valid: boolean;
  userId: string;
  tier: 'free' | 'premium' | 'team';
  rateLimit: {
    requestsPerMinute: number;
    draftsPerDay: number;
    rewritesPerDay: number;
    draftsUsedToday: number;
    rewritesUsedToday: number;
  };
  voiceModelStatus: 'ready' | 'training' | 'not_started';
}

// --- Message Passing ---

export type MessageType =
  | 'COMPOSE_DETECTED'
  | 'COMPOSE_CLOSED'
  | 'RECIPIENT_CHANGED'
  | 'TEXT_SELECTED'
  | 'REQUEST_CONTEXT'
  | 'REQUEST_DRAFT'
  | 'REQUEST_REWRITE'
  | 'REQUEST_GRAMMAR'
  | 'INSERT_DRAFT'
  | 'AUTH_STATUS'
  | 'SIDE_PANEL_READY'
  | 'PLATFORM_DETECTED'
  | 'AUTH_TOKEN'
  | 'AUTH_TOKEN_FROM_WEB'
  | 'AUTH_EXPIRED'
  | 'AUTH_RECOVERED'
  // Phase 1: Inline compose buttons
  | 'INLINE_DRAFT_REQUEST'
  | 'INLINE_REWRITE_REQUEST'
  | 'INLINE_GRAMMAR_REQUEST'
  // Phase 2: Relationship popup
  | 'REQUEST_CONTACT_POPUP'
  | 'DISMISS_POPUP'
  // Phase 3: Grammarly-style suggestions
  | 'INLINE_GRAMMAR_CHECK'
  | 'GRAMMAR_SUGGESTIONS'
  // Phase 4: Command center
  | 'OPEN_SIDE_PANEL'
  // Phase 5: Intelligence
  | 'BRIEFING_REQUEST'
  | 'NUDGE_DETECTED'
  | 'DECAY_ALERT'
  // Phase 6: LinkedIn comment drafting
  | 'COMMENT_DRAFT_REQUEST'
  | 'INSERT_COMMENT_DRAFT'
  // Auto-context
  | 'THREAD_OPENED'
  | 'PING'
  | 'GET_COMPOSE_STATE'
  // v0.6 Inline composer (Surface A)
  | 'GET_RELATIONSHIP_TIER'
  // v0.7 Compose pop-over (Surface B)
  | 'GET_PROACTIVE_SUGGESTIONS'
  | 'OPEN_THREAD';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload?: T;
  token?: string;
  tabId?: number;
}

// --- Store State ---

export type ViewMode = 'context' | 'draft' | 'rewrite' | 'grammar' | 'briefing' | 'nudges' | 'snippets' | 'auth' | 'onboarding';

// --- Phase 5: Intelligence Types ---

export interface MeetingBriefing {
  meetingTitle: string;
  startTime: string;
  attendees: Array<{
    name: string;
    email: string;
    tier: string;
    health: string | null;
    lastInteraction: string | null;
    recentTopics: string[];
  }>;
  talkingPoints: string[];
  openThreads: string[];
  riskFlags: string[];
}

export interface FollowUpNudge {
  id: string;
  contactName: string;
  contactEmail: string;
  tier: string;
  reason: string;
  suggestedAction: string;
  priority: 'high' | 'medium' | 'low';
  daysSinceLastContact: number;
  draftPrompt: string;
}

export interface DecayAlert {
  contactName: string;
  contactEmail: string;
  tier: string;
  previousHealth: string;
  currentHealth: string;
  daysSilent: number;
  suggestedAction: string;
}

export interface IntelligenceState {
  briefings: MeetingBriefing[];
  nudges: FollowUpNudge[];
  decayAlerts: DecayAlert[];
  isBriefingLoading: boolean;
  isNudgesLoading: boolean;
}

export interface AppState {
  // Auth
  isAuthenticated: boolean;
  authToken: string | null;
  user: AuthResponse | null;
  // True once checkAuth has completed at least one round-trip. Lets the
  // UI hold off rendering the unauth flicker on cold open while we wait
  // on validateAuth (~500ms).
  isAuthChecked: boolean;
  // The last-known-good auth.valid value, persisted to chrome.storage.
  // On cold open we render the optimistic state from this immediately
  // and reconcile when checkAuth resolves.
  lastKnownAuthValid: boolean;

  // Current context
  currentPlatform: Platform;
  composeContext: ComposeContext | null;
  contactContext: ContactContext | null;
  contactContextLookup: { email?: string; name?: string; linkedinUrl?: string } | null;

  // Draft
  currentDraft: DraftResponse | null;
  isDraftLoading: boolean;
  isDraftStreaming: boolean;
  streamingDraftText: string;

  // Rewrite
  rewriteResult: RewriteResponse | null;
  isRewriteLoading: boolean;

  // Grammar
  grammarResult: GrammarResponse | null;
  isGrammarLoading: boolean;

  // UI
  viewMode: ViewMode;
  isLoading: boolean;
  error: string | null;

  // Intelligence (Phase 5)
  briefings: MeetingBriefing[];
  nudges: FollowUpNudge[];
  decayAlerts: DecayAlert[];
  isBriefingLoading: boolean;
  isNudgesLoading: boolean;

  // Onboarding
  hasSeenOnboarding: boolean;
  interactionCount: number;
}

// --- Rate Limits ---

export const RATE_LIMITS = {
  free: { requestsPerMinute: 10, draftsPerDay: 15, rewritesPerDay: 25 },
  premium: { requestsPerMinute: 30, draftsPerDay: Infinity, rewritesPerDay: Infinity },
  team: { requestsPerMinute: 60, draftsPerDay: Infinity, rewritesPerDay: Infinity },
} as const;


