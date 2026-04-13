interface CarDiagramProps {
  activePosition: number;
}

const POSITIONS = [
  { id: 1, label: "Front Centre", x: 50, y: 8 },
  { id: 2, label: "Front-Left Corner", x: 18, y: 18 },
  { id: 3, label: "Left Side", x: 10, y: 50 },
  { id: 4, label: "Rear-Left Corner", x: 18, y: 82 },
  { id: 5, label: "Rear Centre", x: 50, y: 92 },
  { id: 6, label: "Rear-Right Corner", x: 82, y: 82 },
  { id: 7, label: "Right Side", x: 90, y: 50 },
  { id: 8, label: "Front-Right Corner", x: 82, y: 18 },
];

const CarDiagram = ({ activePosition }: CarDiagramProps) => {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Car body - top-down view */}
      <g transform="translate(100,100)">
        {/* Car outline */}
        <path
          d="M-28,-70 C-28,-70 -35,-55 -35,-40 L-35,45 C-35,55 -30,65 -25,70 L25,70 C30,65 35,55 35,45 L35,-40 C35,-55 28,-70 28,-70 L-28,-70 Z"
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="2"
          opacity="0.6"
        />
        {/* Windshield */}
        <path
          d="M-24,-58 C-24,-58 -20,-45 -20,-40 L20,-40 C20,-45 24,-58 24,-58 Z"
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
          opacity="0.4"
        />
        {/* Rear window */}
        <path
          d="M-22,45 C-22,50 -18,58 -18,58 L18,58 C18,58 22,50 22,45 Z"
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
          opacity="0.4"
        />
        {/* Wheels */}
        <rect x="-40" y="-45" width="8" height="18" rx="3" fill="hsl(var(--muted-foreground))" opacity="0.3" />
        <rect x="32" y="-45" width="8" height="18" rx="3" fill="hsl(var(--muted-foreground))" opacity="0.3" />
        <rect x="-40" y="28" width="8" height="18" rx="3" fill="hsl(var(--muted-foreground))" opacity="0.3" />
        <rect x="32" y="28" width="8" height="18" rx="3" fill="hsl(var(--muted-foreground))" opacity="0.3" />
      </g>

      {/* Position markers */}
      {POSITIONS.map((pos) => {
        const isActive = pos.id === activePosition;
        return (
          <g key={pos.id}>
            {/* Pulse ring for active */}
            {isActive && (
              <circle
                cx={(pos.x / 100) * 200}
                cy={(pos.y / 100) * 200}
                r="12"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                opacity="0.4"
              >
                <animate attributeName="r" from="8" to="16" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
            <circle
              cx={(pos.x / 100) * 200}
              cy={(pos.y / 100) * 200}
              r="8"
              fill={isActive ? "hsl(var(--primary))" : "hsl(var(--muted))"}
              stroke={isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
              strokeWidth="1.5"
              opacity={isActive ? 1 : 0.5}
            />
            <text
              x={(pos.x / 100) * 200}
              y={(pos.y / 100) * 200 + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="8"
              fontWeight="bold"
              fill={isActive ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))"}
            >
              {pos.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default CarDiagram;
export { POSITIONS };
