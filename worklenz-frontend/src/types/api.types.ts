export interface IServerResponse<T> {
  success: boolean;  // Add this property
  message?: string;
  body?: T;
  status?: number;
}

export interface ICSVTemplateResponse {
  required_fields: string[];
  optional_fields: string[];
  project_statuses: Array<{
    id: string;
    name: string;
    category: string;
    is_done: boolean;
  }>;
  priorities: Array<{
    id: string;
    name: string;
    value: number;
    color: string;
  }>;
  team_members: Array<{
    id: string;
    name: string;
    email: string;
    avatar_url?: string;
  }>;
}

export interface ICSVImportResponse {
  imported_count: number;
  errors?: Array<{
    row: number;
    message: string;
  }>;
}