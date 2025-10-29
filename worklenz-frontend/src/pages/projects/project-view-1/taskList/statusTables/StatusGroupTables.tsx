import { TaskType } from '@/types/task.types';
import { useAppSelector } from '@/hooks/useAppSelector';
import { Flex } from '@/shared/antd-imports';
import TaskListTableWrapper from '@/pages/projects/project-view-1/taskList/taskListTable/TaskListTableWrapper';
import { createPortal } from 'react-dom';
import BulkTasksActionContainer from '@/features/projects/bulkActions/BulkTasksActionContainer';
import { useAppDispatch } from '@/hooks/useAppDispatch';
import { deselectAll } from '@/features/projects/bulkActions/bulkActionSlice';
import { ITaskListGroup } from '@/types/tasks/taskList.types';

const StatusGroupTables = ({ group }: { group: ITaskListGroup }) => {
  const dispatch = useAppDispatch();

  // get bulk action detatils
  const selectedTaskIdsList = useAppSelector(state => state.bulkActionReducer.selectedTaskIdsList);

  const themeMode = useAppSelector(state => state.themeReducer.mode);

  // function for getting a color regarding the status (prefer backend-provided colors)
  const getStatusColor = (
    status: string,
    color_code?: string,
    color_code_dark?: string
  ) => {
    // Prefer explicit colors coming from backend/status model
    if (themeMode === 'dark' && color_code_dark) return color_code_dark;
    if (themeMode !== 'dark' && color_code) return color_code;

    // Fallback normalization when color codes are missing
    const normalized = (status || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    switch (normalized) {
      case 'todo':
      case 'to_do':
      case 'to-do':
      case 'to do':
        return themeMode === 'dark' ? '#3a3a3a' : '#d8d7d8';
      case 'doing':
      case 'in_progress':
      case 'in-progress':
      case 'in progress':
        return themeMode === 'dark' ? '#3d506e' : '#c0d5f6';
      case 'done':
        return themeMode === 'dark' ? '#3b6149' : '#c2e4d0';
      default:
        return themeMode === 'dark' ? '#3a3a3a' : '#d8d7d8';
    }
  };

  return (
    <Flex gap={24} vertical>
      {group?.tasks?.map(status => (
        <TaskListTableWrapper
          key={status.id}
          taskList={group.tasks}
          tableId={status.id || ''}
          name={status.name || ''}
          type="status"
          statusCategory={status.status || ''}
          color={getStatusColor(status.status || '', (status as any)?.color_code, (status as any)?.color_code_dark)}
        />
      ))}

      {/* bulk action container ==> used tailwind to recreate the animation */}
      {createPortal(
        <div
          className={`absolute bottom-0 left-1/2 z-20 -translate-x-1/2 ${selectedTaskIdsList.length > 0 ? 'overflow-visible' : 'h-px overflow-hidden'}`}
        >
          <div
            className={`${selectedTaskIdsList.length > 0 ? 'bottom-4' : 'bottom-0'} absolute left-1/2 z-999 -translate-x-1/2 transition-all duration-300`}
          >
            <BulkTasksActionContainer
              selectedTaskIds={selectedTaskIdsList}
              closeContainer={() => dispatch(deselectAll())}
            />
          </div>
        </div>,
        document.body
      )}
    </Flex>
  );
};

export default StatusGroupTables;
