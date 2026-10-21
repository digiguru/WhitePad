import type { ClassroomConnection as HubConnection } from '../services/connection';
import { Student } from '../shared/types/messages';
import StudentTile from './StudentTile';
import { TeacherBoardStates } from './teacherBoardState';

interface StudentGridProps {
  students: Student[];
  boards: TeacherBoardStates;
  connection: HubConnection | null;
  roomId: string;
  focusedStudentId: string | null;
  onFocusStudent: (studentId: string) => void;
  onExitFocus: () => void;
}

function StudentGrid({
  students,
  boards,
  connection,
  roomId,
  focusedStudentId,
  onFocusStudent,
  onExitFocus,
}: StudentGridProps) {
  if (students.length === 0) {
    return (
      <div className="student-grid">
        <p>No students connected yet. Share the join URL with students.</p>
      </div>
    );
  }

  return (
    <div className={`student-grid ${focusedStudentId ? 'focus-active' : ''}`}>
      {students.map(student => (
        <StudentTile
          key={student.studentId}
          student={student}
          boardState={boards[student.studentId]}
          connection={connection}
          roomId={roomId}
          isFocused={focusedStudentId === student.studentId}
          isFocusActive={focusedStudentId !== null}
          onRequestFocus={onFocusStudent}
          onExitFocus={onExitFocus}
        />
      ))}
    </div>
  );
}

export default StudentGrid;
