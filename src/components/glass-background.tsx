export function GlassBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* Deep base */}
      <div className="absolute inset-0 bg-[#060918]" />

      {/* Pink orb — top left */}
      <div
        className="absolute -top-[200px] -left-[100px] w-[800px] h-[800px] rounded-full animate-pulse-slow"
        style={{
          background: 'radial-gradient(circle, rgba(255,60,172,0.12) 0%, rgba(120,75,160,0.06) 40%, transparent 70%)',
        }}
      />

      {/* Blue orb — bottom right */}
      <div
        className="absolute -bottom-[200px] -right-[200px] w-[600px] h-[600px] rounded-full animate-pulse-slow"
        style={{
          background: 'radial-gradient(circle, rgba(43,134,197,0.10) 0%, transparent 60%)',
          animationDelay: '4s',
        }}
      />

      {/* Purple orb — center */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full animate-pulse-slow"
        style={{
          background: 'radial-gradient(circle, rgba(120,75,160,0.08) 0%, transparent 60%)',
          animationDelay: '2s',
        }}
      />
    </div>
  );
}
