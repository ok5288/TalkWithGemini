import React from "react";

export const Logo = ({
  className = "w-6 h-6",
  ...props
}: React.SVGProps<SVGSVGElement>) => (
  <svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" className={className} {...props}>
    <defs>
      {/* 3D 叠层阴影效果 */}
      <filter id="layer-shadow" x="-30%" y="-30%" width="140%" height="140%">
        <feDropShadow dx="-2" dy="3" stdDeviation="3.5" floodColor="#050b14" floodOpacity="0.32" />
      </filter>
      <filter id="text-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.5" dy="1.5" stdDeviation="1.2" floodColor="#0d1b2a" floodOpacity="0.25" />
      </filter>

      {/* C字环各段渐变色 */}
      <linearGradient id="grad-top-circle" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00f5ff" />
        <stop offset="100%" stopColor="#00bbf9" />
      </linearGradient>

      <linearGradient id="grad-top-seg" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#00f5ff" />
        <stop offset="35%" stopColor="#00f5a0" />
        <stop offset="70%" stopColor="#00dbde" />
        <stop offset="100%" stopColor="#0072ff" />
      </linearGradient>

      {/* 优化的 grad-left-seg 渐变色 */}
      <linearGradient id="grad-left-seg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0072ff" />
        <stop offset="55%" stopColor="#5b00ff" /> {/* 调整 offset 到 55% */}
        <stop offset="100%" stopColor="#7f00ff" />
      </linearGradient>

      {/* 优化的 grad-bottom-seg 渐变色 */}
      <linearGradient id="grad-bottom-seg" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#7f00ff" />
        <stop offset="50%" stopColor="#b100ff" /> {/* 调整 offset 到 50% */}
        <stop offset="100%" stopColor="#ec407a" />
      </linearGradient>

      <linearGradient id="grad-bottom-circle" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#df47ff" />
        <stop offset="100%" stopColor="#9d27b0" />
      </linearGradient>

      {/* 文字专属渐变色 */}
      <linearGradient id="grad-text-ed" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00f5ff" />
        <stop offset="100%" stopColor="#0072ff" />
      </linearGradient>

      <linearGradient id="grad-text-i" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#00f5ff" />
        <stop offset="50%" stopColor="#0072ff" />
        <stop offset="100%" stopColor="#aa00ff" />
      </linearGradient>

      <linearGradient id="grad-text-chat" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8e24aa" />
        <stop offset="100%" stopColor="#da12ff" />
      </linearGradient>
    </defs>

    {/* 第一层：底部紫色弧段 (最底层) */}
    <path d="M 67.0 157.15 A 66 66 0 0 0 157.15 133.0" fill="none" stroke="url(#grad-bottom-seg)" strokeWidth="38" strokeLinecap="round" />

    {/* 第二层：左侧蓝色弧段 (叠加在紫色之上，带阴影) */}
    <path d="M 42.85 67.0 A 66 66 0 0 0 94.25 165.75" fill="none" stroke="url(#grad-left-seg)" strokeWidth="38" strokeLinecap="round" filter="url(#layer-shadow)" />

    {/* 第三层：顶部青色弧段 (叠加在蓝色之上，带阴影) */}
    <path d="M 157.15 67.0 A 66 66 0 0 0 34.26 105.75" fill="none" stroke="url(#grad-top-seg)" strokeWidth="38" strokeLinecap="round" filter="url(#layer-shadow)" />

    {/* 第四层：右下角紫色球形端点 (叠加在底部弧段之上，带阴影) */}
    <circle cx="157.15" cy="133.0" r="19" fill="url(#grad-bottom-circle)" filter="url(#layer-shadow)" />

    {/* 第五层：右上角青色球形端点 (叠加在顶部弧段之上，带阴影) */}
    <circle cx="157.15" cy="67.0" r="19" fill="url(#grad-top-circle)" filter="url(#layer-shadow)" />

    {/* 中心文字组 (带微阴影提升可读性) */}
    <g filter="url(#text-shadow)">
      {/* "Ed" */}
      <text x="62" y="109" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" fontWeight="800" fontSize="25" fill="url(#grad-text-ed)" letterSpacing="-0.5">Ed</text>
      
      {/* "i" 字母图标化 */}
      <rect x="97" y="90.5" width="11.5" height="33.5" rx="3.75" fill="url(#grad-text-i)" />
      <circle cx="102.75" cy="77.5" r="6.2" fill="#00f5ff" />
      
      {/* "Chat" */}
      <text x="111.5" y="109" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" fontWeight="800" fontSize="25" fill="url(#grad-text-chat)" letterSpacing="-0.5">Chat</text>
    </g>
  </svg>
);

export const BubblesLoading = ({
  className = "",
  ...props
}: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 32 24"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <circle cx="0" cy="12" r="0" transform="translate(8 0)" fill="currentColor">
      <animate
        attributeName="r"
        begin="0"
        calcMode="spline"
        dur="1.2s"
        keySplines="0.2 0.2 0.4 0.8;0.2 0.6 0.4 0.8;0.2 0.6 0.4 0.8"
        keyTimes="0;0.2;0.7;1"
        repeatCount="indefinite"
        values="0; 4; 0; 0"
      />
    </circle>
    <circle
      cx="0"
      cy="12"
      r="0"
      transform="translate(16 0)"
      fill="currentColor"
    >
      <animate
        attributeName="r"
        begin="0.3"
        calcMode="spline"
        dur="1.2s"
        keySplines="0.2 0.2 0.4 0.8;0.2 0.6 0.4 0.8;0.2 0.6 0.4 0.8"
        keyTimes="0;0.2;0.7;1"
        repeatCount="indefinite"
        values="0; 4; 0; 0"
      />
    </circle>
    <circle
      cx="0"
      cy="12"
      r="0"
      transform="translate(24 0)"
      fill="currentColor"
    >
      <animate
        attributeName="r"
        begin="0.6"
        calcMode="spline"
        dur="1.2s"
        keySplines="0.2 0.2 0.4 0.8;0.2 0.6 0.4 0.8;0.2 0.6 0.4 0.8"
        keyTimes="0;0.2;0.7;1"
        repeatCount="indefinite"
        values="0; 4; 0; 0"
      />
    </circle>
  </svg>
);
