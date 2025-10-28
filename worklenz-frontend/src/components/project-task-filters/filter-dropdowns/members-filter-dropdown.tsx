import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDownFilled } from '@/shared/antd-imports';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Flex,
  Input,
  List,
  Space,
  Typography,
  InputRef
} from '@/shared/antd-imports';

import { useAppDispatch } from '@/hooks/useAppDispatch';
import { useAppSelector } from '@/hooks/useAppSelector';

import { colors } from '@/styles/colors';
import SingleAvatar from '@components/common/single-avatar/single-avatar';
import { fetchTaskGroups, setMembers } from '@/features/tasks/tasks.slice';
import { fetchBoardTaskGroups, setBoardMembers } from '@/features/board/board-slice';
import useTabSearchParam from '@/hooks/useTabSearchParam';

interface Member {
  id: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  selected: boolean;
}

const MembersFilterDropdown = () => {
  const membersInputRef = useRef<InputRef>(null);
  const dispatch = useAppDispatch();
  const { projectView } = useTabSearchParam();
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useTranslation('task-list-filters');

  const themeMode = useAppSelector(state => state.themeReducer.mode);
  const { taskAssignees } = useAppSelector(state => state.taskReducer);
  const { taskAssignees: boardTaskAssignees } = useAppSelector(state => state.boardReducer);
  const { projectId } = useAppSelector(state => state.projectReducer);


  const selectedCount = useMemo(() => {
    return projectView === 'list'
      ? taskAssignees.filter(member => member.selected).length
      : boardTaskAssignees.filter(member => member.selected).length;
  }, [taskAssignees, boardTaskAssignees, projectView]);

  // Calculate selected member IDs from current view
  const selectedMemberIds = useMemo(() => {
    const members = projectView === 'list' ? taskAssignees : boardTaskAssignees;
    return members.filter(member => member.selected).map(member => member.id);
  }, [taskAssignees, boardTaskAssignees, projectView]);

  // Update selections and save to localStorage
  const updateSelections = useCallback(async (memberId: string, checked: boolean) => {
    if (!projectId) return;

    const members = projectView === 'list' ? taskAssignees : boardTaskAssignees;
    const updatedMembers = members.map(member =>
      member.id === memberId ? { ...member, selected: checked } : member
    );

    // Update Redux state
    if (projectView === 'list') {
      dispatch(setMembers(updatedMembers));
      dispatch(fetchTaskGroups(projectId));
    } else {
      dispatch(setBoardMembers(updatedMembers));
      dispatch(fetchBoardTaskGroups(projectId));
    }

    // Save to localStorage
    const selectedIds = updatedMembers.filter(m => m.selected).map(m => m.id);
    const storageKey = `memberSelections_${projectId}_${projectView}`;
    localStorage.setItem(storageKey, JSON.stringify(selectedIds));
  }, [projectId, projectView, taskAssignees, boardTaskAssignees, dispatch]);

  const filteredMembersData = useMemo(() => {
    const members = projectView === 'list' ? taskAssignees : boardTaskAssignees;
    return members.filter(member => member.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [taskAssignees, boardTaskAssignees, searchQuery, projectView]);

  const renderMemberItem = (member: Member) => (
    <List.Item
      className={`custom-list-item ${themeMode === 'dark' ? 'dark' : ''}`}
      key={member.id}
      style={{ display: 'flex', gap: 8, padding: '4px 8px', border: 'none' }}
    >
      <Checkbox
        id={member.id}
        checked={selectedMemberIds.includes(member.id)}
        onChange={e => updateSelections(member.id, e.target.checked)}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SingleAvatar avatarUrl={member.avatar_url} name={member.name} email={member.email} />
          <Flex vertical>
            {member.name}
            <Typography.Text style={{ fontSize: 12, color: colors.lightGray }}>
              {member.email}
            </Typography.Text>
          </Flex>
        </div>
      </Checkbox>
    </List.Item>
  );

  const membersDropdownContent = (
    <Card className="custom-card" styles={{ body: { padding: 8 } }}>
      <Flex vertical gap={8}>
        <Input
          ref={membersInputRef}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('searchInputPlaceholder')}
        />
        <List style={{ padding: 0, maxHeight: 250, overflow: 'auto' }}>
          {filteredMembersData.length ? (
            filteredMembersData.map((member, index) => renderMemberItem(member as Member))
          ) : (
            <Empty />
          )}
        </List>
      </Flex>
    </Card>
  );

  const handleMembersDropdownOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setTimeout(() => membersInputRef.current?.focus(), 0);
        // Only sync the members if board members are empty
        if (
          projectView === 'kanban' &&
          boardTaskAssignees.length === 0 &&
          taskAssignees.length > 0
        ) {
          dispatch(setBoardMembers(taskAssignees));
        }
      }
    },
    [dispatch, taskAssignees, boardTaskAssignees, projectView]
  );

  const buttonStyle = {
    backgroundColor:
      selectedCount > 0 ? (themeMode === 'dark' ? '#003a5c' : colors.paleBlue) : colors.transparent,
    color: selectedCount > 0 ? (themeMode === 'dark' ? 'white' : colors.darkGray) : 'inherit',
  };

  return (
    <Dropdown
      overlayClassName="custom-dropdown"
      trigger={['click']}
      dropdownRender={() => membersDropdownContent}
      onOpenChange={handleMembersDropdownOpen}
    >
      <Button icon={<CaretDownFilled />} iconPosition="end" style={buttonStyle}>
        <Space>
          {t('membersText')}
          {selectedCount > 0 && <Badge size="small" count={selectedCount} color={colors.skyBlue} />}
        </Space>
      </Button>
    </Dropdown>
  );
};

export default MembersFilterDropdown;
