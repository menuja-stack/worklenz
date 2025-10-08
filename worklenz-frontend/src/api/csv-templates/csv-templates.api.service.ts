import apiClient from '../api-client';
import { IServerResponse } from '@/types/api.types';
import { IProjectTask } from '@/types/project/projectTasksViewModel.types';

// Enhanced CSV Import specific types
export interface ICSVImportRequest {
  projectId: string;
  tasks: IProjectTask[];
  userMappings?: UserMapping[];
  fieldMappings?: FieldMapping[];
  validateOnly?: boolean;
}

export interface ICSVImportResponse {
  message: string;
  imported_count: number;
  validation_warnings?: string[];
  import_errors?: string[];
  project_name: string;
}

export interface ICSVValidationResponse {
  is_valid: boolean;
  total_tasks: number;
  valid_tasks: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'error';
  field: string;
  message: string;
  task_data?: any;
}

export interface ValidationWarning {
  type: 'warning';
  field: string;
  message: string;
  task_name?: string;
  email?: string;
  priority?: string;
  status?: string;
}

export interface UserMapping {
  csvUser: string;
  worklenzUser: string;
  action: 'create' | 'map' | 'skip';
  email?: string;
}

export interface FieldMapping {
  csvField: string;
  worklenzField: string;
  required: boolean;
  mapped: boolean;
  fieldValue?: string; // optional fixed value for fields like priority/status
}

// Removed other API contracts to align with minimal endpoints

const BASE_URL = '/api/v1/task-csv-import';

// Template payload returned by backend get_csv_import_template_fields
export interface ICSVTemplate {
  project_statuses: Array<{
    id: string;
    name: string;
    category: string;
    sort_order: number;
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
  debug_info?: any;
}

export const csvImportApiService = {
  /**
   * Import tasks from CSV data with user and field mappings
   * @param projectId - The target project ID
   * @param tasks - Array of tasks parsed from CSV
   * @param userMappings - Optional user mappings for assignee resolution
   * @param fieldMappings - Optional field mappings for CSV columns
   */
  importTasks: async (
    projectId: string,
    tasks: IProjectTask[],
    userMappings: UserMapping[],
    fieldMappings: FieldMapping[]
  ): Promise<IServerResponse<ICSVImportResponse>> => {
    // Add validation
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    try {
      const response = await apiClient.post<IServerResponse<ICSVImportResponse>>(
        `${BASE_URL}/${projectId}/tasks`,
        {
          tasks,
          userMappings,
          fieldMappings
        }
      );
      return response.data;
    } catch (error) {
      console.error('Import Tasks Error:', error);
      throw error;
    }
  },

  /**
   * Fetch template fields (statuses, priorities, team members) for a project
   */
  getTemplate: async (
    projectId: string
  ): Promise<IServerResponse<ICSVTemplate>> => {
    if (!projectId) throw new Error('Project ID is required');
    const response = await apiClient.get<IServerResponse<ICSVTemplate>>(
      `${BASE_URL}/${projectId}/template`
    );
    return response.data;
  },

  /**
   * Validate CSV tasks before importing
   * @param projectId - The target project ID  
   * @param tasks - Array of tasks to validate
   */
  validateTasks: async (
    projectId: string,
    tasks: IProjectTask[]
  ): Promise<IServerResponse<ICSVValidationResponse>> => {
    try {
      const response = await apiClient.post<IServerResponse<ICSVValidationResponse>>(
        `${BASE_URL}/${projectId}/validate`,
        { tasks }
      );
      return response.data;
    } catch (error) {
      console.error('Validation error:', error);
      throw error;
    }
  },
};
// Removed dev-time test and ancillary helpers
