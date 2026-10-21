import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import type { ClassroomConnection as HubConnection } from '../../services/connection';
import { StudentLocked } from '../../shared/types/messages';
import { HubEvents } from '../../shared/constants/hubContract';

type StudentLockState = {
  isLocked: boolean;
  setIsLocked: Dispatch<SetStateAction<boolean>>;
};

type UseStudentLockStateOptions = {
  connection: HubConnection;
  studentId: string;
  initialIsLocked?: boolean;
};

export function useStudentLockState({
  connection,
  studentId,
  initialIsLocked = false,
}: UseStudentLockStateOptions): StudentLockState {
  const [isLocked, setIsLocked] = useState(initialIsLocked);

  useEffect(() => {
    setIsLocked(initialIsLocked);
  }, [studentId, initialIsLocked]);

  useEffect(() => {
    const handleStudentLocked = (message: StudentLocked) => {
      if (message.studentId === studentId) {
        setIsLocked(message.isLocked);
      }
    };

    connection.on(HubEvents.StudentLocked, handleStudentLocked);
    return () => {
      connection.off(HubEvents.StudentLocked, handleStudentLocked);
    };
  }, [connection, studentId]);

  return {
    isLocked,
    setIsLocked,
  };
}
