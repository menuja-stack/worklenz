import { Badge, Flex, Select } from '@/shared/antd-imports';
import './home-tasks-status-dropdown.css';
import { useAppSelector } from '@/hooks/useAppSelector';
import { useTranslation } from 'react-i18next';
import { ITaskStatus } from '@/types/status.types';
import { useState, useEffect, useMemo } from 'react';
import { ALPHA_CHANNEL } from '@/shared/constants';
import { useSocket } from '@/socket/socketContext';
import { SocketEvents } from '@/shared/socket-events';
import { ITaskListStatusChangeResponse } from '@/types/tasks/task-list-status.types';
import { IProjectTask } from '@/types/project/projectTasksViewModel.types';
import { useGetMyTasksQuery } from '@/api/home-page/home-page.api.service';

type HomeTasksStatusDropdownProps = {
  task: IProjectTask;
  teamId: string;
};

const HomeTasksStatusDropdown = ({ task, teamId }: HomeTasksStatusDropdownProps) => {
  const { t } = useTranslation('task-list-table');
  const { socket, connected } = useSocket();
  const { homeTasksConfig } = useAppSelector(state => state.homePageReducer);
  const { refetch } = useGetMyTasksQuery(homeTasksConfig, {
    skip: false, // Ensure this query runs
  });

  const [selectedStatus, setSelectedStatus] = useState<ITaskStatus | undefined>(undefined);
  const themeMode = useAppSelector(state => state.themeReducer.mode);

  const handleStatusChange = (statusId: string) => {
    if (!task.id || !statusId) return;

    socket?.emit(
      SocketEvents.TASK_STATUS_CHANGE.toString(),
      JSON.stringify({
        task_id: task.id,
        status_id: statusId,
        parent_task: task.parent_task_id || null,
        team_id: teamId,
      })
    );
    getTaskProgress(task.id);
  };

  const handleTaskStatusChange = (response: ITaskListStatusChangeResponse) => {
    if (response && response.id === task.id) {
      // Update selected status using resolver
      const next = resolveStatus({
        status_id: response.status_id,
        status: undefined as any,
        status_category: response.statusCategory,
      } as any);
      if (next) setSelectedStatus(next);
      // Only refetch when there's an actual status change
      if (response.status_id !== task.status_id) {
        refetch();
      }
    }
  };

  const getTaskProgress = (taskId: string) => {
    socket?.emit(SocketEvents.GET_TASK_PROGRESS.toString(), taskId);
  };

  // Helper: resolve current status from id/name/category with robust fallbacks
  const resolveStatus = (src: Pick<typeof task, 'status_id' | 'status' | 'status_category'>) => {
    const normalize = (val?: string) => (val || '').toLowerCase().replace(/\s|_/g, '');
    const statuses = task.project_statuses || [];

    // 1) Match by id
    if (src.status_id) {
      const found = statuses.find(s => s.id === src.status_id);
      if (found) return found;
    }
    // 2) Match by name
    if (src.status) {
      const byName = statuses.find(s => normalize(s.name) === normalize(src.status));
      if (byName) return byName;
    }
    // 3) Match by category flags
    const cat = src.status_category;
    if (cat) {
      const wanted = cat.is_done ? 'done' : cat.is_doing ? 'doing' : 'todo';
      const byCat = statuses.find(s => normalize(s.name) === wanted);
      if (byCat) return byCat;
      // Last-resort synthetic status with palette similar to project view
      return {
        id: wanted,
        name: wanted === 'done' ? 'Done' : wanted === 'doing' ? 'Doing' : 'To do',
        color_code: wanted === 'done' ? '#34d399' : wanted === 'doing' ? '#60a5fa' : '#9ca3af',
        color_code_dark: wanted === 'done' ? '#10b981' : wanted === 'doing' ? '#3b82f6' : '#6b7280',
      } as unknown as ITaskStatus;
    }
    return undefined;
  };

  useEffect(() => {
    setSelectedStatus(resolveStatus(task));
  }, [task.status_id, task.status, task.status_category, task.project_statuses]);

  useEffect(() => {
    socket?.on(SocketEvents.TASK_STATUS_CHANGE.toString(), handleTaskStatusChange);

    return () => {
      socket?.removeListener(SocketEvents.TASK_STATUS_CHANGE.toString(), handleTaskStatusChange);
    };
  }, [connected]);

  const options = useMemo(
    () =>
      task.project_statuses?.map(status => ({
        value: status.id,
        label: (
          <Flex gap={8} align="center">
            <Badge color={themeMode === 'dark' ? (status.color_code_dark || status.color_code) : status.color_code} text={status.name} />
          </Flex>
        ),
      })),
    [task.project_statuses, themeMode]
  );

  return (
    <>
      {
        <Select
          variant="borderless"
          size="small"
          value={task.status_id}
          onChange={handleStatusChange}
          dropdownMatchSelectWidth={false}
          getPopupContainer={triggerNode => triggerNode.parentElement as HTMLElement}
          dropdownStyle={{ borderRadius: 8, minWidth: 150, maxWidth: 200 }}
          style={{
            backgroundColor:
              themeMode === 'dark'
                ? (
                    selectedStatus?.color_code_dark ||
                    task.status_color_dark ||
                    selectedStatus?.color_code ||
                    task.status_color ||
                    '#6b7280'
                  )
                : (
                    selectedStatus?.color_code ||
                    task.status_color ||
                    '#6b7280'
                  ),
            borderRadius: 16,
            height: 24,
            minWidth: 70,
            color: '#ffffff',
            paddingInline: 10,
            display: 'inline-flex',
            alignItems: 'center',
          }}
          suffixIcon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 9l-7 7-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ffffff' }} />
            </svg>
          }
          labelRender={value => {
            const status = task.project_statuses?.find(status => status.id === value.value);
            return status ? <span style={{ fontSize: 12, color: '#ffffff' }}>{status.name}</span> : '';
          }}
          options={options}
        />
      }
    </>
  );
};

export default HomeTasksStatusDropdown;
