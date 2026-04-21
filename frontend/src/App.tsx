import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Quest } from './pages/Quest';

export default function App() {
  return (
    <BrowserRouter>
      <div className="relative min-h-screen overflow-x-hidden">
        {/* Ambient glow */}
        <div
          className="glow-ambient"
          style={{
            top: '-200px',
            left: '-100px',
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, #c7ff3a 0%, transparent 70%)',
          }}
        />
        <div
          className="glow-ambient"
          style={{
            bottom: '-200px',
            right: '-100px',
            width: '700px',
            height: '700px',
            background: 'radial-gradient(circle, #ff7849 0%, transparent 70%)',
            opacity: 0.15,
          }}
        />
        <div className="grain" />

        <div className="relative z-10">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/quest/:id" element={<Quest />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
