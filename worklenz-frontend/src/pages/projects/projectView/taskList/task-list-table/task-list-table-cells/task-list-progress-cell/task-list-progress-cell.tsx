import React from 'react';
import { Progress, Tooltip } from '@/shared/antd-imports';
import './task-list-progress-cell.css';
import { IProjectTask } from '@/types/project/projectTasksViewModel.types';
import { useAppSelector } from '@/hooks/useAppSelector';

type TaskListProgressCellProps = {
  task: IProjectTask;
};

const TaskListProgressCell = ({ task }: TaskListProgressCellProps) => {
  const { project } = useAppSelector(state => state.projectReducer);
  
  const isManualProgressEnabled =
    task.project_use_manual_progress ||
    task.project_use_weighted_progress ||
    task.project_use_time_progress;
  const isSubtask = task.is_sub_task;
  const hasManualProgress = task.manual_progress;

  // Determine which progress value to display
  // Priority: progress_value (manual) > complete_ratio (calculated from subtasks) > progress (fallback)
  const getProgressValue = () => {
    // If manual progress is set, use progress_value
    if (hasManualProgress || isManualProgressEnabled) {
      return task.progress_value ?? task.complete_ratio ?? task.progress ?? 0;
    }
    // Otherwise use complete_ratio (calculated from subtasks)
    return task.complete_ratio ?? task.progress ?? 0;
  };

  const progressValue = getProgressValue();

  // Handle different cases:
  // 1. For subtasks when manual progress is not enabled, don't show progress
  // 2. For all other cases, show the progress

  if (isSubtask && !isManualProgressEnabled) {
    return null; // Don't show progress for subtasks when manual progress is disabled
  }

  // Determine tooltip content
  const getTooltipTitle = () => {
    if (hasManualProgress || isManualProgressEnabled) {
      return `Manual Progress: ${progressValue}%`;
    }
    if (!isSubtask && (task.total_tasks_count ?? 0) > 0) {
      return `${task.completed_count || 0} / ${task.total_tasks_count || 0} tasks completed (${progressValue}%)`;
    }
    return `${progressValue}%`;
  };

  return (
    <Tooltip title={getTooltipTitle()}>
      <Progress
        percent={progressValue}
        type="circle"
        size={isSubtask ? 22 : 24}
        style={{ cursor: 'default' }}
        strokeWidth={progressValue >= 100 ? 9 : 7}
      />
    </Tooltip>
  );
};

export default TaskListProgressCell;
