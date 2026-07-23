type DeskFlowStep = {
  label: string;
  hint?: string;
};

export function DeskFlow({
  steps,
  title = "Desk workflow",
  className = "",
}: {
  steps: DeskFlowStep[];
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={`desk-flow ${className}`.trim()}
      style={{ ["--desk-flow-steps" as string]: steps.length }}
    >
      <p className="desk-flow__title">{title}</p>
      <ol className="desk-flow__track" aria-label={title}>
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={`${i}-${step.label}`} className="desk-flow__step">
              <div className="desk-flow__rail" aria-hidden>
                <span className={`desk-flow__badge ${isLast ? "desk-flow__badge--final" : ""}`}>
                  {isLast ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.2 5 8.7 9.5 3.8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
              </div>
              <div className="desk-flow__body">
                <p className="desk-flow__label">{step.label}</p>
                {step.hint ? <p className="desk-flow__hint">{step.hint}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
