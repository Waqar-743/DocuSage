import React from 'react';

type Props = {
  className?: string;
  dotClassName?: string;
  label?: string;
};

/**
 * Compact 3-dot animated loading indicator shown whenever a model is loading
 * or generating its first tokens.
 */
export const LoadingDots: React.FC<Props> = ({
  className = '',
  dotClassName = '',
  label = 'Loading',
}) => (
  <span
    role="status"
    aria-label={label}
    className={`ds-loading-dots inline-flex items-center gap-1 ${className}`}
  >
    <span className={`ds-loading-dot w-1.5 h-1.5 rounded-full bg-current ${dotClassName}`} />
    <span className={`ds-loading-dot w-1.5 h-1.5 rounded-full bg-current ${dotClassName}`} />
    <span className={`ds-loading-dot w-1.5 h-1.5 rounded-full bg-current ${dotClassName}`} />
  </span>
);
