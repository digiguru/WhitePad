import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TeacherApp from './teacher/TeacherApp';
import StudentApp from './student/StudentApp';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/teacher" element={<TeacherApp />} />
        <Route path="/web-join" element={<StudentApp />} />
        <Route path="/join" element={<StudentApp />} />
        <Route path="/" element={<Navigate to="/teacher" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
