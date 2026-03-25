export interface Project {
  id: string;
  title: string;
  description: string;
  instructions: string;
  account_id: string;
  account_name?: string;
  voiceCreditUsedUsd?: number;
  textCreditUsedUsd?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  account_id?: string;
  account_name?: string;
  last_active: string;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  monthly_limit_usd: number;
  warning_threshold_percent: number;
  hard_stop_enabled: boolean;
  branding_json: string;
  status?: 'active' | 'blocked' | 'warning' | 'capped' | 'suspended';
  isBlocked?: boolean;
  totalSpentUsd?: number;
}

export interface BillingLog {
  id: string;
  account_id: string;
  project_id: string;
  session_id: string;
  type: 'voice' | 'text';
  amount_usd: number;
  details: string;
  created_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  title: string;
  content: string;
  file_url?: string;
  original_filename?: string;
  mime_type?: string;
  page_count?: number;
  created_at: string;
}

export interface AnalyticsData {
  totalSessions: number;
  activeKiosks: number;
  totalDocuments: number;
  totalMessages: number;
  accuracy: number;
  sessionVolume: number[];
  distribution: {
    correct: number;
    clarifications: number;
    unknowns: number;
  };
  location_points: {
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    count: number;
  }[];
  top_countries: {
    country: string;
    count: number;
  }[];
  device_breakdown: {
    mobile: number;
    desktop: number;
  };
  sentimentTotals: {
    positive: number;
    neutral: number;
    negative: number;
  };
  activeProjects: number;
  billing?: {
    totalSpentUsd: number;
    voiceSpentUsd: number;
    voiceSeconds: number;
    textSpentUsd: number;
    textCharacters: number;
  };
}

export type Analytics = AnalyticsData;

export interface ProjectMessageLogItem {
  id: string;
  session_id: string;
  role: 'user' | 'model';
  content: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sources?: any[];
  created_at: string;
}

export interface GlobalMessageLogItem extends ProjectMessageLogItem {
  project_title: string;
  account_name: string;
}

export interface UsageLogItem {
  id: string;
  created_at: string;
  account_name: string;
  project_title: string;
  type: 'voice' | 'text';
  units: number;
  cost_usd: number;
  message_content: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  totalPages: number;
  page: number;
}

export interface Message {
  id: string;
  session_id?: string;
  project_id?: string;
  role: 'user' | 'assistant' | 'model';
  content: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  sources?: any[];
  created_at: string;
}
