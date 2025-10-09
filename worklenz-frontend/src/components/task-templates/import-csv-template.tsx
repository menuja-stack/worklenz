import React, { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Divider,
  Modal,
  Flex,
  List,
  Typography,
  Upload,
  message,
  Alert,
  Progress,
  Space,
  Steps,
  Form,
  Select,
  Input,
  Card,
  Row,
  Col,
  Table,
  Switch,
  Tag,
  Checkbox,
  Radio
} from 'antd';
import {
  InboxOutlined,
  DeleteOutlined,
  UploadOutlined,
  SettingOutlined,
  UserOutlined,
  EyeOutlined,
  ImportOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { csvImportApiService } from '@/api/csv-templates/csv-templates.api.service';
import { setImportCSVTemplateDrawerOpen } from '@/features/project/project.slice';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { RootState } from '@/app/store';
import { Avatar } from 'antd';
import { useSelector } from 'react-redux';
import { IServerResponse } from '@/types/api.types';
const { Dragger } = Upload;
const { Text, Title } = Typography;
const { Option } = Select;

// Enhanced Types
interface IProjectTask {
  id: string;
  name: string;
  description?: string;
  priority?: string;
  assignee?: string;
  dueDate?: string;
  status?: string;
  manual_progress: boolean;
}

interface ImportCSVProps {
  projectId: string;
  onImport: (tasks: IProjectTask[]) => Promise<boolean>;
}

interface FieldMapping {
  csvField: string;
  worklenzField: string;
  required: boolean;
  mapped: boolean;
}

// New interface for value mapping (Priority/Status)
interface ValueMapping {
  csvValue: string;
  worklenzValue: string;
  fieldType: 'priority' | 'status';
}

interface UserMapping {
  csvUser: string;
  worklenzUser: string;
  action: 'create' | 'map' | 'skip';
  email?: string;
  team_member_id?: string;
}

interface ProjectTemplate {
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
  }>;
}

// Enhanced CSV parsing utility function with better error handling
const parseCSV = (csvText: string): { data: Record<string, string>[]; errors: string[]; fields: string[] } => {
  const lines = csvText.trim().split(/\r?\n/);
  const errors: string[] = [];

  if (lines.length === 0) {
    return { data: [], errors: ['Empty CSV file'], fields: [] };
  }

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));
  const fields = [...headers];

  if (headers.length === 0) {
    return { data: [], errors: ['No headers found in CSV'], fields: [] };
  }

  const data: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line).map(v => v.replace(/^"|"$/g, ''));

    if (values.length !== headers.length) {
      errors.push(`Row ${i + 1}: Expected ${headers.length} columns, found ${values.length}`);
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    data.push(row);
  }

  return { data, errors, fields };
};

const ImportCSVTemplate: React.FC<ImportCSVProps> = ({
  onImport
}) => {
  const { t } = useTranslation('project-view/import-csv-template');
  const dispatch = useAppDispatch();
  const { importCSVTemplateDrawerOpen, projectId } = useAppSelector(state => state.projectReducer);

  // Steps state
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  // CSV data state
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [csvFields, setCsvFields] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  // Project defaults (no backend template)
  const [projectTemplate, setProjectTemplate] = useState<ProjectTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Field mapping state
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  
  // NEW: Value mapping state for Priority and Status
  const [valueMappings, setValueMappings] = useState<ValueMapping[]>([]);
  const [uniquePriorityValues, setUniquePriorityValues] = useState<string[]>([]);
  const [uniqueStatusValues, setUniqueStatusValues] = useState<string[]>([]);

  // User mapping state
  const [userMappings, setUserMappings] = useState<UserMapping[]>([]);
  const [csvUsers, setCsvUsers] = useState<string[]>([]);

  // Import state
  const [importing, setImporting] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  // Worklenz Priority and Status options
  const worklenzPriorities = [
    { value: 'Low', label: 'Low', color: '#52c41a' },
    { value: 'Medium', label: 'Medium', color: '#faad14' },
    { value: 'High', label: 'High', color: '#ff4d4f' }
  ];

  const worklenzStatuses = [
    { value: 'To Do', label: 'To Do', color: '#d9d9d9' },
    { value: 'In Progress', label: 'In Progress', color: '#1890ff' },
    { value: 'Done', label: 'Done', color: '#52c41a' }
  ];

  // Available Worklenz fields
  const worklenzFields = [
    { value: 'name', label: t('mapFieldsStep.worklenzFields.name'), required: true },
    { value: 'description', label: t('mapFieldsStep.worklenzFields.description'), required: false },
    { value: 'assignee', label: t('mapFieldsStep.worklenzFields.assignee'), required: false },
    { value: 'dueDate', label: t('mapFieldsStep.worklenzFields.dueDate'), required: false },
    { value: 'status', label: t('mapFieldsStep.worklenzFields.status'), required: false },
    { value: 'priority', label: t('mapFieldsStep.worklenzFields.priority'), required: false },
    { value: 'labels', label: t('mapFieldsStep.worklenzFields.labels'), required: false },
    { value: 'estimation', label: t('mapFieldsStep.worklenzFields.estimation'), required: false },
    { value: 'startDate', label: t('mapFieldsStep.worklenzFields.startDate'), required: false },
    { value: 'reporter', label: t('mapFieldsStep.worklenzFields.reporter'), required: false }
  ];

  // Steps configuration - Added new step for value mapping
  const steps = [
    {
      title: t('steps.uploadCsv.title'),
      icon: <UploadOutlined />,
    },
    {
      title: t('steps.mapFields.title'),
      icon: <ArrowRightOutlined />,
    },
    {
      title: 'Map Values', // NEW STEP
      icon: <SettingOutlined />,
    },
    {
      title: t('steps.moveUsers.title'),
      icon: <UserOutlined />,
    },
    {
      title: t('steps.reviewImport.title'),
      icon: <EyeOutlined />,
    }
  ];

  // Load project template data on component mount
  useEffect(() => {
    if (importCSVTemplateDrawerOpen && projectId) {
      loadProjectTemplate();
    }
  }, [importCSVTemplateDrawerOpen, projectId]);

  useEffect(() => {
    if (csvFields.length > 0) {
      initializeFieldMappings();
    }
  }, [csvFields]);

  // Extract unique values when field mappings change
  useEffect(() => {
    if (fieldMappings.length > 0 && csvData.length > 0) {
      extractUniqueValues();
      extractUsersFromCSV();
    }
  }, [fieldMappings, csvData]);

  const loadProjectTemplate = async () => {
    setLoadingTemplate(true);
    try {
      if (!projectId) return;
      const res = await csvImportApiService.getTemplate(projectId);
      if (res.success && res.body) {
        const tpl = res.body as any;
        setProjectTemplate({
          required_fields: ['name'],
          optional_fields: ['description','assignee','dueDate','status','priority'],
          project_statuses: Array.isArray(tpl.project_statuses) ? tpl.project_statuses : [],
          priorities: Array.isArray(tpl.priorities) ? tpl.priorities : [],
          team_members: Array.isArray(tpl.team_members) ? tpl.team_members : []
        });
      } else {
        // fallback to minimal defaults
        setProjectTemplate({
          required_fields: ['name'],
          optional_fields: ['description','assignee','dueDate','status','priority'],
          project_statuses: [],
          priorities: [],
          team_members: []
        });
      }
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleClose = () => {
    setCsvData([]);
    setCsvFields([]);
    setParseErrors([]);
    setUploadProgress(0);
    setCurrentStep(0);
    setCompletedSteps([]);
    setFieldMappings([]);
    setValueMappings([]);
    setUniquePriorityValues([]);
    setUniqueStatusValues([]);
    setUserMappings([]);
    setCsvUsers([]);
    setValidationResult(null);
    dispatch(setImportCSVTemplateDrawerOpen(false));
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setParseErrors([]);
    setUploadProgress(0);

    console.log('=== FILE UPLOAD STARTED ===');
    console.log('File Name:', file.name);
    console.log('File Size:', file.size);
    console.log('File Type:', file.type);
    console.log('===========================');

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 100);

      const fileReader = new FileReader();

      fileReader.onload = async (e) => {
        clearInterval(progressInterval);
        setUploadProgress(100);

        try {
          const csvText = e.target?.result as string;
          if (!csvText) {
            setParseErrors([t('uploadStep.processing.failedToRead')]);
            message.error(t('messages.error.failedToReadFile'));
            return;
          }

          console.log('=== CSV PARSING ===');
          console.log('CSV Text Length:', csvText.length);
          console.log('First 200 characters:', csvText.substring(0, 200));

          const { data, errors: parseErrors, fields } = parseCSV(csvText);

          console.log('Parsed Fields:', fields);
          console.log('Parsed Rows Count:', data.length);
          console.log('Parse Errors:', parseErrors);

          if (parseErrors.length > 0) {
            setParseErrors(parseErrors);
            message.error(t('messages.error.csvParsingErrors', { count: parseErrors.length }));
            return;
          }

          setCsvData(data);
          setCsvFields(fields);

          if (data.length > 0) {
            message.success(t('messages.success.csvParsed', { count: data.length }));
            setCompletedSteps([0]);
          } else {
            message.warning(t('uploadStep.processing.noDataFound'));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : t('errors.unknownError');
          console.error('CSV Processing Error:', error);
          setParseErrors([t('messages.error.failedToParseFile') + ': ' + errorMessage]);
          message.error(t('messages.error.failedToParseFile'));
        }
      };

      fileReader.onerror = () => {
        clearInterval(progressInterval);
        setParseErrors([t('uploadStep.processing.failedToRead')]);
        message.error(t('messages.error.failedToReadFile'));
      };

      fileReader.readAsText(file);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('errors.unknownError');
      console.error('Error processing CSV:', error);
      setParseErrors([t('messages.error.failedToProcessFile') + ': ' + errorMessage]);
      message.error(t('messages.error.failedToProcessFile'));
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }

    return false;
  };

  const initializeFieldMappings = () => {
    const mappings: FieldMapping[] = csvFields.map(csvField => {
      const lowerCsvField = csvField.toLowerCase().replace(/[^a-z]/g, '');
      let worklenzField = '';

      if (['name', 'title', 'summary', 'task', 'taskname'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'name';
      } else if (['description', 'desc', 'details'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'description';
      } else if (['assignee', 'assigned', 'owner', 'responsible'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'assignee';
      } else if (['duedate', 'due', 'deadline', 'enddate'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'dueDate';
      } else if (['priority', 'prio', 'importance'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'priority';
      } else if (['status', 'state', 'stage'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'status';
      } else if (['labels', 'tags', 'categories'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'labels';
      } else if (['estimation', 'estimate', 'effort', 'hours'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'estimation';
      } else if (['startdate', 'start', 'begin'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'startDate';
      } else if (['reporter', 'creator', 'author'].some(keyword => lowerCsvField.includes(keyword))) {
        worklenzField = 'reporter';
      }

      console.log(`Auto-mapping: ${csvField} -> ${worklenzField}`);

      return {
        csvField,
        worklenzField,
        required: worklenzField === 'name',
        mapped: worklenzField !== ''
      };
    });

    setFieldMappings(mappings);
    console.log('=== FIELD MAPPINGS INITIALIZED ===');
    console.log('Field Mappings:', mappings);
    console.log('==================================');
  };

  // NEW: Extract unique priority and status values from CSV
  const extractUniqueValues = () => {
    const priorityFields = fieldMappings.filter(m => m.worklenzField === 'priority').map(m => m.csvField);
    const statusFields = fieldMappings.filter(m => m.worklenzField === 'status').map(m => m.csvField);

    const priorities = new Set<string>();
    const statuses = new Set<string>();

    csvData.forEach(row => {
      priorityFields.forEach(field => {
        if (row[field] && row[field].trim()) {
          priorities.add(row[field].trim());
        }
      });

      statusFields.forEach(field => {
        if (row[field] && row[field].trim()) {
          statuses.add(row[field].trim());
        }
      });
    });

    const uniquePriorities = Array.from(priorities);
    const uniqueStatuses = Array.from(statuses);

    setUniquePriorityValues(uniquePriorities);
    setUniqueStatusValues(uniqueStatuses);

    console.log('=== UNIQUE VALUES EXTRACTED ===');
    console.log('Unique Priorities:', uniquePriorities);
    console.log('Unique Statuses:', uniqueStatuses);

    // Initialize value mappings with smart defaults
    const newValueMappings: ValueMapping[] = [];

    uniquePriorities.forEach(csvValue => {
      const lowerValue = csvValue.toLowerCase();
      let worklenzValue = 'Medium'; // default

      if (['low', 'minor', 'trivial', '1'].some(keyword => lowerValue.includes(keyword))) {
        worklenzValue = 'Low';
      } else if (['high', 'critical', 'urgent', 'blocker', '3', '4', '5'].some(keyword => lowerValue.includes(keyword))) {
        worklenzValue = 'High';
      } else if (['medium', 'normal', 'major', '2'].some(keyword => lowerValue.includes(keyword))) {
        worklenzValue = 'Medium';
      }

      newValueMappings.push({
        csvValue,
        worklenzValue,
        fieldType: 'priority'
      });
    });

    uniqueStatuses.forEach(csvValue => {
      const lowerValue = csvValue.toLowerCase();
      let worklenzValue = 'To Do'; // default

      if (['todo', 'open', 'new', 'backlog', 'pending'].some(keyword => lowerValue.includes(keyword))) {
        worklenzValue = 'To Do';
      } else if (['inprogress', 'progress', 'working', 'active', 'started'].some(keyword => lowerValue.includes(keyword))) {
        worklenzValue = 'In Progress';
      } else if (['done', 'completed', 'closed', 'resolved', 'finished'].some(keyword => lowerValue.includes(keyword))) {
        worklenzValue = 'Done';
      }

      newValueMappings.push({
        csvValue,
        worklenzValue,
        fieldType: 'status'
      });
    });

    setValueMappings(newValueMappings);
    console.log('Value Mappings:', newValueMappings);
    console.log('===============================');
  };

  const extractUsersFromCSV = () => {
    const assigneeFields = fieldMappings.filter(m => m.worklenzField === 'assignee').map(m => m.csvField);
    const users = new Set<string>();

    csvData.forEach(row => {
      assigneeFields.forEach(field => {
        if (row[field] && row[field].trim()) {
          users.add(row[field].trim());
        }
      });
    });

    const uniqueUsers = Array.from(users);
    setCsvUsers(uniqueUsers);

    console.log('=== USERS EXTRACTED FROM CSV ===');
    console.log('Assignee Fields:', assigneeFields);
    console.log('Unique Users Found:', uniqueUsers);

    const teamMembers = projectTemplate?.team_members || [];
    const userMappings: UserMapping[] = uniqueUsers.map(user => {
      const existingMember = teamMembers.find(member => member.email.toLowerCase() === user.toLowerCase());
      
      return {
        csvUser: user,
        worklenzUser: existingMember?.email || '',
        action: existingMember ? 'map' : 'create',
        email: user.includes('@') ? user : ''
      };
    });

    setUserMappings(userMappings);
    console.log('User Mappings:', userMappings);
    console.log('================================');
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCompletedSteps([...completedSteps, currentStep]);
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return csvData.length > 0 && parseErrors.length === 0;
      case 1:
        const hasNameField = fieldMappings.some(m => m.worklenzField === 'name' && m.mapped);
        return hasNameField;
      case 2: // Value mapping step
        // Check if all priority and status values are mapped
        const hasPriorityField = fieldMappings.some(m => m.worklenzField === 'priority' && m.mapped);
        const hasStatusField = fieldMappings.some(m => m.worklenzField === 'status' && m.mapped);
        
        if (hasPriorityField && uniquePriorityValues.length > 0) {
          const allPrioritiesMapped = uniquePriorityValues.every(csvValue =>
            valueMappings.some(vm => vm.csvValue === csvValue && vm.fieldType === 'priority' && vm.worklenzValue)
          );
          if (!allPrioritiesMapped) return false;
        }
        
        if (hasStatusField && uniqueStatusValues.length > 0) {
          const allStatusesMapped = uniqueStatusValues.every(csvValue =>
            valueMappings.some(vm => vm.csvValue === csvValue && vm.fieldType === 'status' && vm.worklenzValue)
          );
          if (!allStatusesMapped) return false;
        }
        
        return true;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleFieldMappingChange = (csvField: string, worklenzField: string) => {
    setFieldMappings(prev =>
      prev.map(mapping => {
        if (mapping.csvField !== csvField) {
          // Ensure unique mapping per Worklenz field
          if (mapping.worklenzField === worklenzField && worklenzField !== '') {
            return { ...mapping, worklenzField: '', mapped: false };
          }
          return mapping;
        }
        return {
          ...mapping,
          worklenzField,
          mapped: worklenzField !== ''
        };
      })
    );

    console.log(`Field mapping changed: ${csvField} -> ${worklenzField}`);
  };

  // NEW: Handle value mapping changes
  const handleValueMappingChange = (csvValue: string, fieldType: 'priority' | 'status', worklenzValue: string) => {
    setValueMappings(prev =>
      prev.map(mapping =>
        mapping.csvValue === csvValue && mapping.fieldType === fieldType
          ? { ...mapping, worklenzValue }
          : mapping
      )
    );

    console.log(`Value mapping changed: ${csvValue} (${fieldType}) -> ${worklenzValue}`);
  };

  const handleUserMappingChange = (csvUser: string, changes: Partial<UserMapping>) => {
    setUserMappings(prev =>
      prev.map(mapping =>
        mapping.csvUser === csvUser
          ? { ...mapping, ...changes }
          : mapping
      )
    );

    console.log(`User mapping changed: ${csvUser}`, changes);
  };

  const handleFinalImport = async () => {
    try {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      setImporting(true);

      const tasks = csvData
        .map((row, index) => {
          const task: IProjectTask = {
            id: `csv-${Date.now()}-${index}`,
            name: '',
            description: '',
            assignee: '',
            dueDate: '',
            manual_progress: false
          };

          fieldMappings.forEach(mapping => {
            if (mapping.mapped && row[mapping.csvField]) {
              const value = row[mapping.csvField].trim();

              switch (mapping.worklenzField) {
                case 'name':
                  task.name = value;
                  break;
                case 'description':
                  task.description = value;
                  break;
                case 'priority':
                  // Map CSV priority value to Worklenz priority
                  const priorityMapping = valueMappings.find(
                    vm => vm.csvValue === value && vm.fieldType === 'priority'
                  );
                  task.priority = priorityMapping?.worklenzValue;
                  break;
                case 'assignee':
                  const userMapping = userMappings.find(um => um.csvUser === value);
                  if (userMapping?.action === 'map' && userMapping.worklenzUser) {
                    task.assignee = userMapping.worklenzUser;
                  } else if (userMapping?.action === 'create' && userMapping.email) {
                    task.assignee = userMapping.email;
                  }
                  break;
                case 'dueDate':
                  task.dueDate = value;
                  break;
                case 'status':
                  // Map CSV status value to Worklenz status
                  const statusMapping = valueMappings.find(
                    vm => vm.csvValue === value && vm.fieldType === 'status'
                  );
                  task.status = statusMapping?.worklenzValue;
                  break;
              }
            }
          });

          return task;
        })
        .filter(task => task.name); // Filter out tasks without names

      console.log('Processed Tasks:', tasks);

      const response = await csvImportApiService.importTasks(
        projectId,
        tasks,
        userMappings,
        fieldMappings
      );
      console.log('Response:', response);

      if (response.done) {
        const importedCount = response.body?.imported_count || 0;
        message.success(`Successfully imported ${importedCount} tasks`);
        if (onImport) {
          await onImport(tasks);
        }
        handleClose();
      } else {
        throw new Error(response.message || 'Import failed');
      }

    } catch (error) {
      console.error('Import Error:', error);
      message.error('Failed to import tasks: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setImporting(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div>
            <Title level={4}>{t('uploadStep.title')}</Title>
            <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
              {t('uploadStep.description')}
            </Text>

            {loadingTemplate && (
              <Alert
                message={t('uploadStep.loadingTemplate')}
                type="info"
                showIcon
                icon={<LoadingOutlined />}
                style={{ marginBottom: 16 }}
              />
            )}

            <Dragger
              accept=".csv"
              beforeUpload={handleFileUpload}
              showUploadList={false}
              disabled={uploading || loadingTemplate}
              style={{ marginBottom: 16 }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">
                {t('uploadStep.uploadArea.dragText')}
              </p>
              <p className="ant-upload-hint">
                {t('uploadStep.uploadArea.hint')}
              </p>
            </Dragger>

            {uploading && (
              <div style={{ marginBottom: 16 }}>
                <Progress percent={uploadProgress} status="active" />
                <Text type="secondary">{t('uploadStep.processing.text')}</Text>
              </div>
            )}

            {parseErrors.length > 0 && (
              <Alert
                message={t('uploadStep.errors.title')}
                description={
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {parseErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                }
                type="error"
                showIcon
                closable
                onClose={() => setParseErrors([])}
                style={{ marginBottom: 16 }}
              />
            )}

            {validationResult && validationResult.warnings && validationResult.warnings.length > 0 && (
              <Alert
                message={t('uploadStep.validationSummary.title', { count: validationResult.warnings.length })}
                description={
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {validationResult.warnings.slice(0, 5).map((warning: any, index: number) => (
                      <li key={index}>{warning.message}</li>
                    ))}
                    {validationResult.warnings.length > 5 && 
                      <li>{t('uploadStep.validationSummary.moreWarnings', { count: validationResult.warnings.length - 5 })}</li>
                    }
                  </ul>
                }
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {csvData.length > 0 && (
              <Card>
                <Title level={5}>{t('uploadStep.preview.title')}</Title>
                <Text>{t('uploadStep.preview.foundData', { rowCount: csvData.length, columnCount: csvFields.length })}</Text>
                <div style={{ marginTop: 8 }}>
                  <Text strong>{t('uploadStep.preview.columnsLabel')} </Text>
                  {csvFields.map((field, index) => (
                    <Tag key={index} style={{ margin: '2px' }}>
                      {field}
                    </Tag>
                  ))}
                </div>

                {validationResult && (
                  <div style={{ marginTop: 16 }}>
                    <Row gutter={16}>
                      <Col span={8}>
                        <div style={{ textAlign: 'center' }}>
                          <Title level={4} style={{ margin: 0, color: validationResult.is_valid ? '#52c41a' : '#ff4d4f' }}>
                            {validationResult.is_valid ? '✓' : '✗'}
                          </Title>
                          <Text type="secondary">{t('uploadStep.validationSummary.status')}</Text>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{ textAlign: 'center' }}>
                          <Title level={4} style={{ margin: 0, color: '#1890ff' }}>
                            {validationResult.valid_tasks}/{validationResult.total_tasks}
                          </Title>
                          <Text type="secondary">{t('uploadStep.validationSummary.validTasks')}</Text>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{ textAlign: 'center' }}>
                          <Title level={4} style={{ margin: 0, color: '#fa8c16' }}>
                            {validationResult.errors?.length || 0}
                          </Title>
                          <Text type="secondary">{t('uploadStep.validationSummary.errors')}</Text>
                        </div>
                      </Col>
                    </Row>
                  </div>
                )}
              </Card>
            )}
          </div>
        );

      case 1:
        return (
          <div>
            <Title level={4}>{t('mapFieldsStep.title')}</Title>
            <Text type="secondary" style={{ marginBottom: 24, display: 'block' }}>
              {t('mapFieldsStep.description')}
            </Text>

            <Table
              dataSource={fieldMappings}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total, range) => `${range[0]}-${range[1]} ${t('common.of')} ${total} ${t('common.columns')}`,
                pageSizeOptions: ['5', '10', '20', '50']
              }}
              rowKey="csvField"
              size='small'
              columns={[
                {
                  title: t('mapFieldsStep.table.csvColumn'),
                  dataIndex: 'csvField',
                  key: 'csvField',
                  render: (text) => <Tag color="blue">{text}</Tag>
                },
                {
                  title: t('mapFieldsStep.table.sampleData'),
                  key: 'sampleData',
                  render: (_, record) => {
                    const sample = csvData.find(row => row[record.csvField]);
                    return (
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        {sample ? sample[record.csvField].substring(0, 50) + (sample[record.csvField].length > 50 ? '...' : '') : '-'}
                      </Text>
                    );
                  }
                },
                {
                  title: t('mapFieldsStep.table.mapToField'),
                  key: 'mapping',
                  render: (_, record) => (
                    <Select
                      value={record.worklenzField}
                      onChange={(value) => handleFieldMappingChange(record.csvField, value)}
                      style={{ width: 200 }}
                      size='small'
                      allowClear
                      placeholder={t('mapFieldsStep.table.selectPlaceholder')}
                    >
                      {worklenzFields.map(field => {
                        const isAlreadyMapped = fieldMappings.some(m =>
                          m.worklenzField === field.value &&
                          m.mapped &&
                          m.csvField !== record.csvField
                        );

                        return (
                          <Option
                            key={field.value}
                            value={field.value}
                            disabled={isAlreadyMapped}
                          >
                            {field.label} {field.required && <Text type="danger">*</Text>}
                            {isAlreadyMapped && <Text type="secondary"> {t('mapFieldsStep.table.alreadyMapped')}</Text>}
                          </Option>
                        );
                      })}
                    </Select>
                  )
                },
                {
                  title: t('mapFieldsStep.table.status'),
                  key: 'status',
                  render: (_, record) => (
                    record.mapped ? (
                      <Tag color="green">
                        <CheckCircleOutlined /> {t('mapFieldsStep.table.mapped')}
                      </Tag>
                    ) : (
                      <Tag>{t('mapFieldsStep.table.notMapped')}</Tag>
                    )
                  )
                }
              ]}
            />

            <Alert
              style={{ marginTop: 16 }}
              message={t('mapFieldsStep.requirements.title')}
              description={t('mapFieldsStep.requirements.description')}
              type="info"
              showIcon
            />
          </div>
        );

      case 2:
        // NEW: Value Mapping Step (Jira-style)
        const hasPriorityMapping = fieldMappings.some(m => m.worklenzField === 'priority' && m.mapped);
        const hasStatusMapping = fieldMappings.some(m => m.worklenzField === 'status' && m.mapped);

        return (
          <div>
            <Title level={4}>Map Priority & Status Values</Title>
            <Text type="secondary" style={{ marginBottom: 24, display: 'block' }}>
              Map your CSV values to Worklenz priorities and statuses. This ensures your data is properly organized in the system.
            </Text>

            {!hasPriorityMapping && !hasStatusMapping && (
              <Alert
                message="No Priority or Status Fields Mapped"
                description="You haven't mapped any Priority or Status fields in the previous step. You can skip this step or go back to add field mappings."
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {hasPriorityMapping && uniquePriorityValues.length > 0 && (
              <Card 
                title={
                  <Space>
                    <SettingOutlined />
                    Priority Value Mapping
                  </Space>
                }
                size="small" 
                style={{ marginBottom: 16 }}
              >
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Found {uniquePriorityValues.length} unique priority value(s) in your CSV. Map each to a Worklenz priority.
                </Text>

                <Table
                  dataSource={valueMappings.filter(vm => vm.fieldType === 'priority')}
                  pagination={false}
                  rowKey="csvValue"
                  size="small"
                  columns={[
                    {
                      title: 'CSV Priority Value',
                      dataIndex: 'csvValue',
                      key: 'csvValue',
                      width: '30%',
                      render: (text) => <Tag color="blue" style={{ fontSize: '13px' }}>{text}</Tag>
                    },
                    {
                      title: 'Sample Tasks',
                      key: 'sampleTasks',
                      width: '30%',
                      render: (_, record) => {
                        const priorityField = fieldMappings.find(m => m.worklenzField === 'priority')?.csvField;
                        if (!priorityField) return '-';
                        
                        const count = csvData.filter(row => row[priorityField] === record.csvValue).length;
                        return (
                          <Text type="secondary">
                            {count} task{count !== 1 ? 's' : ''} with this priority
                          </Text>
                        );
                      }
                    },
                    {
                      title: 'Map to Worklenz Priority',
                      key: 'mapping',
                      width: '40%',
                      render: (_, record) => (
                        <Select
                          value={record.worklenzValue}
                          onChange={(value) => handleValueMappingChange(record.csvValue, 'priority', value)}
                          style={{ width: '100%' }}
                          size="small"
                        >
                          {worklenzPriorities.map(priority => (
                            <Option key={priority.value} value={priority.value}>
                              <Space>
                                <div
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: priority.color,
                                    display: 'inline-block'
                                  }}
                                />
                                {priority.label}
                              </Space>
                            </Option>
                          ))}
                        </Select>
                      )
                    }
                  ]}
                />
              </Card>
            )}

            {hasStatusMapping && uniqueStatusValues.length > 0 && (
              <Card 
                title={
                  <Space>
                    <SettingOutlined />
                    Status Value Mapping
                  </Space>
                }
                size="small"
              >
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Found {uniqueStatusValues.length} unique status value(s) in your CSV. Map each to a Worklenz status.
                </Text>

                <Table
                  dataSource={valueMappings.filter(vm => vm.fieldType === 'status')}
                  pagination={false}
                  rowKey="csvValue"
                  size="small"
                  columns={[
                    {
                      title: 'CSV Status Value',
                      dataIndex: 'csvValue',
                      key: 'csvValue',
                      width: '30%',
                      render: (text) => <Tag color="cyan" style={{ fontSize: '13px' }}>{text}</Tag>
                    },
                    {
                      title: 'Sample Tasks',
                      key: 'sampleTasks',
                      width: '30%',
                      render: (_, record) => {
                        const statusField = fieldMappings.find(m => m.worklenzField === 'status')?.csvField;
                        if (!statusField) return '-';
                        
                        const count = csvData.filter(row => row[statusField] === record.csvValue).length;
                        return (
                          <Text type="secondary">
                            {count} task{count !== 1 ? 's' : ''} with this status
                          </Text>
                        );
                      }
                    },
                    {
                      title: 'Map to Worklenz Status',
                      key: 'mapping',
                      width: '40%',
                      render: (_, record) => (
                        <Select
                          value={record.worklenzValue}
                          onChange={(value) => handleValueMappingChange(record.csvValue, 'status', value)}
                          style={{ width: '100%' }}
                          size="small"
                        >
                          {worklenzStatuses.map(status => (
                            <Option key={status.value} value={status.value}>
                              <Space>
                                <div
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: status.color,
                                    display: 'inline-block'
                                  }}
                                />
                                {status.label}
                              </Space>
                            </Option>
                          ))}
                        </Select>
                      )
                    }
                  ]}
                />
              </Card>
            )}

            {(hasPriorityMapping || hasStatusMapping) && (
              <Alert
                style={{ marginTop: 16 }}
                message="Value Mapping Required"
                description="All priority and status values from your CSV must be mapped to continue. This ensures data consistency in your project."
                type="warning"
                showIcon
              />
            )}
          </div>
        );

      case 3:
        return (
          <div>
            <Title level={4}>{t('moveUsersStep.title')}</Title>
            <Text type="secondary" style={{ marginBottom: 24, display: 'block' }}>
              {t('moveUsersStep.description')}
            </Text>

            {csvUsers.length === 0 ? (
              <Alert
                message={t('moveUsersStep.noUsers.title')}
                description={t('moveUsersStep.noUsers.description')}
                type="info"
                showIcon
              />
            ) : (
              <div>
                <Card size="small" style={{ marginBottom: 16 }}>
                  <Text strong>{t('moveUsersStep.availableMembers')}</Text>
                  <div style={{ marginTop: 8 }}>
                    {projectTemplate?.team_members?.map(member => (
                      <Tag key={member.id} color="green" style={{ margin: '2px' }}>
                        {member.name} ({member.email})
                      </Tag>
                    )) || <Text type="secondary">{t('moveUsersStep.loadingMembers')}</Text>}
                  </div>
                </Card>

                <Table
                  dataSource={userMappings}
                  pagination={false}
                  rowKey="csvUser"
                  size="small"
                  columns={[
                    {
                      title: t('moveUsersStep.table.userInCsv'),
                      dataIndex: 'csvUser',
                      key: 'csvUser',
                      render: (text) => <Tag color="blue">{text}</Tag>
                    },
                    {
                      title: t('moveUsersStep.table.action'),
                      key: 'action',
                      render: (_, record) => (
                        <Select
                          value={record.action}
                          onChange={(value) => handleUserMappingChange(record.csvUser, { action: value })}
                          style={{ width: 120 }}
                          size="small"
                        >
                          <Option value="create">{t('moveUsersStep.actions.createUser')}</Option>
                          <Option value="map">{t('moveUsersStep.actions.mapToExisting')}</Option>
                          <Option value="skip">{t('moveUsersStep.actions.skip')}</Option>
                        </Select>
                      )
                    },
                    {
                      title: t('moveUsersStep.table.mapToUser'),
                      key: 'mapping',
                      render: (_, record) => {
                        if (record.action === 'map') {
                          return (
                            <MemberMappingSelect
                              record={record}
                              onChange={(changes) => handleUserMappingChange(record.csvUser, changes)}
                            />
                          );
                        } else if (record.action === 'create') {
                          return (
                            <Input
                              value={record.email}
                              onChange={(e) => handleUserMappingChange(record.csvUser, { email: e.target.value })}
                              placeholder={t('moveUsersStep.table.enterEmailForNewUser')}
                              style={{ width: 200 }}
                              size="small"
                            />
                          );
                        }
                        return <Text type="secondary">-</Text>;
                      }
                    },
                    {
                      title: t('moveUsersStep.table.status'),
                      key: 'status',
                      render: (_, record) => {
                        if (record.action === 'skip') {
                          return <Tag>{t('moveUsersStep.statuses.skipped')}</Tag>;
                        } else if (record.action === 'create') {
                          return record.email ? 
                            <Tag color="green">{t('moveUsersStep.statuses.readyToCreate')}</Tag> : 
                            <Tag color="orange">{t('moveUsersStep.statuses.emailRequired')}</Tag>;
                        } else if (record.action === 'map') {
                          return record.worklenzUser ? 
                            <Tag color="blue">{t('moveUsersStep.statuses.mapped')}</Tag> : 
                            <Tag color="orange">{t('moveUsersStep.statuses.mappingRequired')}</Tag>;
                        }
                        return null;
                      }
                    }
                  ]}
                />
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <div>
            <Title level={4}>{t('reviewStep.title')}</Title>
            <Text type="secondary" style={{ marginBottom: 24, display: 'block' }}>
              {t('reviewStep.description')}
            </Text>

            <Row gutter={16}>
              <Col span={24}>
                <Card title={t('reviewStep.summary.title')} size="small" style={{ marginBottom: 16 }}>
                  <Row gutter={16}>
                    <Col span={6}>
                      <div style={{ textAlign: 'center' }}>
                        <Title level={3} style={{ margin: 0, color: '#1890ff' }}>
                          {csvData.length}
                        </Title>
                        <Text type="secondary">{t('reviewStep.summary.csvRows')}</Text>
                      </div>
                    </Col>
                    <Col span={6}>
                      <div style={{ textAlign: 'center' }}>
                        <Title level={3} style={{ margin: 0, color: '#52c41a' }}>
                          {fieldMappings.filter(m => m.mapped).length}/{fieldMappings.length}
                        </Title>
                        <Text type="secondary">{t('reviewStep.summary.mappedFields')}</Text>
                      </div>
                    </Col>
                    <Col span={6}>
                      <div style={{ textAlign: 'center' }}>
                        <Title level={3} style={{ margin: 0, color: '#fa8c16' }}>
                          {userMappings.filter(m => m.action === 'create').length}
                        </Title>
                        <Text type="secondary">{t('reviewStep.summary.usersToCreate')}</Text>
                      </div>
                    </Col>
                    <Col span={6}>
                      <div style={{ textAlign: 'center' }}>
                        <Title level={3} style={{ margin: 0, color: '#722ed1' }}>
                          {csvData.filter(row => {
                            const nameField = fieldMappings.find(m => m.worklenzField === 'name');
                            return nameField && row[nameField.csvField];
                          }).length}
                        </Title>
                        <Text type="secondary">{t('reviewStep.summary.tasksToImport')}</Text>
                      </div>
                    </Col>
                  </Row>
                </Card>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Card title={t('reviewStep.fieldMappings.title')} size="small" style={{ marginBottom: 16 }}>
                  {fieldMappings.filter(m => m.mapped).map(mapping => (
                    <div key={mapping.csvField} style={{ 
                      marginBottom: 8, 
                      padding: '8px', 
                      backgroundColor: '#f5f5f5', 
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12
                    }}>
                      <Tag color="blue" style={{ margin: 0 }}>{mapping.csvField}</Tag>
                      <ArrowRightOutlined style={{ color: '#999' }} />
                      <Tag color="green" style={{ margin: 0 }}>
                        {worklenzFields.find(f => f.value === mapping.worklenzField)?.label}
                      </Tag>
                    </div>
                  ))}

                  {fieldMappings.filter(m => m.mapped).length === 0 && (
                    <Text type="secondary">{t('reviewStep.fieldMappings.noMappings')}</Text>
                  )}
                </Card>
              </Col>

              <Col span={12}>
                <Card title={t('reviewStep.userMappings.title')} size="small">
                  {userMappings.length > 0 ? (
                    userMappings.map(mapping => (
                      <div key={mapping.csvUser} style={{ 
                        marginBottom: 8, 
                        padding: '8px', 
                        backgroundColor: '#f5f5f5', 
                        borderRadius: '4px' 
                      }}>
                        <div>
                          <Tag color="blue">{mapping.csvUser}</Tag>
                          <ArrowRightOutlined style={{ color: '#999', margin: '0 8px' }} />
                          {mapping.action === 'create' ? (
                            <Tag color="orange">{t('reviewStep.userMappings.create', { email: mapping.email })}</Tag>
                          ) : mapping.action === 'map' ? (
                            <Tag color="green">{t('reviewStep.userMappings.map', { user: mapping.worklenzUser })}</Tag>
                          ) : (
                            <Tag>{t('moveUsersStep.actions.skip')}</Tag>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <Text type="secondary">{t('reviewStep.userMappings.noMappings')}</Text>
                  )}
                </Card>
              </Col>
            </Row>

            {/* NEW: Value Mappings Summary */}
            {valueMappings.length > 0 && (
              <Row gutter={16} style={{ marginTop: 16 }}>
                <Col span={24}>
                  <Card title="Value Mappings Summary" size="small">
                    <Row gutter={16}>
                      {valueMappings.filter(vm => vm.fieldType === 'priority').length > 0 && (
                        <Col span={12}>
                          <Text strong style={{ display: 'block', marginBottom: 8 }}>Priority Mappings:</Text>
                          {valueMappings.filter(vm => vm.fieldType === 'priority').map(vm => (
                            <div key={vm.csvValue} style={{ marginBottom: 4 }}>
                              <Tag color="blue">{vm.csvValue}</Tag>
                              <ArrowRightOutlined style={{ fontSize: '12px', margin: '0 4px' }} />
                              <Tag color={
                                vm.worklenzValue === 'High' ? 'red' :
                                vm.worklenzValue === 'Medium' ? 'orange' : 'green'
                              }>{vm.worklenzValue}</Tag>
                            </div>
                          ))}
                        </Col>
                      )}
                      {valueMappings.filter(vm => vm.fieldType === 'status').length > 0 && (
                        <Col span={12}>
                          <Text strong style={{ display: 'block', marginBottom: 8 }}>Status Mappings:</Text>
                          {valueMappings.filter(vm => vm.fieldType === 'status').map(vm => (
                            <div key={vm.csvValue} style={{ marginBottom: 4 }}>
                              <Tag color="cyan">{vm.csvValue}</Tag>
                              <ArrowRightOutlined style={{ fontSize: '12px', margin: '0 4px' }} />
                              <Tag color={
                                vm.worklenzValue === 'Done' ? 'green' :
                                vm.worklenzValue === 'In Progress' ? 'blue' : 'default'
                              }>{vm.worklenzValue}</Tag>
                            </div>
                          ))}
                        </Col>
                      )}
                    </Row>
                  </Card>
                </Col>
              </Row>
            )}

            <Card title={t('reviewStep.sampleData.title')} size="small" style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                {t('reviewStep.sampleData.description')}
              </Text>
              
              {csvData.slice(0, 3).map((row, index) => {
                const previewTask: any = { id: index };
                
                fieldMappings.forEach(mapping => {
                  if (mapping.mapped && row[mapping.csvField]) {
                    const value = row[mapping.csvField].trim();
                    switch (mapping.worklenzField) {
                      case 'name':
                        previewTask.name = value;
                        break;
                      case 'description':
                        previewTask.description = value;
                        break;
                      case 'priority':
                        const priorityMapping = valueMappings.find(
                          vm => vm.csvValue === value && vm.fieldType === 'priority'
                        );
                        previewTask.priority = priorityMapping?.worklenzValue;
                        break;
                      case 'assignee':
                        const userMapping = userMappings.find(um => um.csvUser === value);
                        previewTask.assignee = userMapping?.worklenzUser || userMapping?.email || value;
                        break;
                      case 'dueDate':
                        previewTask.dueDate = value;
                        break;
                      case 'status':
                        const statusMapping = valueMappings.find(
                          vm => vm.csvValue === value && vm.fieldType === 'status'
                        );
                        previewTask.status = statusMapping?.worklenzValue;
                        break;
                    }
                  }
                });

                return (
                  <div key={index} style={{ 
                    marginBottom: 12, 
                    padding: '12px', 
                    border: '1px solid #d9d9d9', 
                    borderRadius: '6px',
                    backgroundColor: '#fafafa'
                  }}>
                    <div><Text strong>{t('reviewStep.sampleData.taskLabel', { index: index + 1 })}</Text> {previewTask.name || t('reviewStep.sampleData.noName')}</div>
                    {previewTask.description && <div><Text type="secondary">{t('reviewStep.sampleData.descriptionLabel')}</Text> {previewTask.description}</div>}
                    <div style={{ marginTop: 4 }}>
                      {previewTask.priority && (
                        <Tag color={
                          previewTask.priority === 'High' ? 'red' :
                          previewTask.priority === 'Medium' ? 'orange' : 'green'
                        }>{previewTask.priority}</Tag>
                      )}
                      {previewTask.status && (
                        <Tag color={
                          previewTask.status === 'Done' ? 'green' :
                          previewTask.status === 'In Progress' ? 'blue' : 'default'
                        }>{previewTask.status}</Tag>
                      )}
                      {previewTask.assignee && <Tag color="purple">{previewTask.assignee}</Tag>}
                      {previewTask.dueDate && <Tag>{previewTask.dueDate}</Tag>}
                    </div>
                  </div>
                );
              })}

              {csvData.length > 3 && (
                <Text type="secondary">{t('reviewStep.sampleData.moreTasks', { count: csvData.length - 3 })}</Text>
              )}
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  const getStepStatus = (stepIndex: number) => {
    if (completedSteps.includes(stepIndex)) {
      return 'finish';
    } else if (stepIndex === currentStep) {
      return 'process';
    } else {
      return 'wait';
    }
  };

  const MemberMappingSelect: React.FC<{
    record: UserMapping;
    onChange: (changes: Partial<UserMapping>) => void;
  }> = ({ record, onChange }) => {
    const members = useAppSelector((state: RootState) => state.teamMembersReducer.teamMembers);
    const [searchText, setSearchText] = useState('');

    const filteredMembers = useMemo(() => {
      return members?.data?.filter(member => 
        member.name?.toLowerCase().includes(searchText.toLowerCase()) ||
        member.email?.toLowerCase().includes(searchText.toLowerCase())
      );
    }, [members, searchText]);

    return (
      <Select
        value={record.team_member_id}
        onChange={(value, option: any) => {
          onChange({
            team_member_id: value,
            worklenzUser: option.email,
          });
        }}
        showSearch
        placeholder={t('memberMapping.selectPlaceholder')}
        optionFilterProp="children"
        style={{ width: 200 }}
        size="small"
        onSearch={setSearchText}
      >
        {filteredMembers?.map(member => (
          <Option 
            key={member.id} 
            value={member.id}
            email={member.email}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Avatar
                src={member.avatar_url}
                size="small"
                style={{ flexShrink: 0 }}
              >
                {member.name?.[0]}
              </Avatar>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{member.name}</span>
                <span style={{ fontSize: '12px', color: '#666' }}>{member.email}</span>
              </div>
            </div>
          </Option>
        ))}
      </Select>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <ImportOutlined />
          {t('modal.title')}
        </Space>
      }
      open={importCSVTemplateDrawerOpen}
      onCancel={handleClose}
      width={1000}
      destroyOnClose
      footer={
        <Flex justify="space-between" align="center">
          <div>
            {currentStep > 0 && (
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={handlePrevious}
              >
                {t('previous')}
              </Button>
            )}
          </div>

          <div>
            <Space>
              <Button onClick={handleClose}>{t('cancel')}</Button>

              {currentStep < steps.length - 1 ? (
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  onClick={handleNext}
                  disabled={!canProceedToNext()}
                >
                  {t('next')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<ImportOutlined />}
                  onClick={handleFinalImport}
                  loading={importing}
                  disabled={!canProceedToNext()}
                >
                  {t('modal.importButton', { 
                    count: csvData.filter(row => {
                      const nameField = fieldMappings.find(m => m.worklenzField === 'name');
                      return nameField && row[nameField.csvField];
                    }).length 
                  })}
                </Button>
              )}
            </Space>
          </div>
        </Flex>
      }
    >
      <div style={{ padding: '0 0 24px 0' }}>
        <Steps
          current={currentStep}
          size="small"
          style={{ marginBottom: 32 }}
          items={steps.map((step, index) => ({
            title: step.title,
            icon: step.icon,
            status: getStepStatus(index)
          }))}
        />

        <div style={{ minHeight: '400px' }}>
          {renderStepContent()}
        </div>
      </div>
    </Modal>
  );
};

export default ImportCSVTemplate;