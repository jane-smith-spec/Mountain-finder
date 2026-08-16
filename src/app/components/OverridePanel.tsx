/**
 * The override panel — the most important idea in this app.
 *
 * Every one of the nine pose fields appears here with its state made visible:
 *
 *   EXIF     read from the photo's own metadata
 *   You      typed into this panel
 *   Assumed  a standard default you explicitly opted into
 *   ⚠ needs input   with the reason, in words
 *
 * The four are visually distinguishable (colour, badge text AND an icon, so it
 * does not rely on colour alone), and a field that needs input renders an EMPTY
 * box — never a zero. A zero in a heading field is a real bearing due north; a
 * zero in an elevation field is sea level. Showing one for "unknown" is exactly
 * the class of silent invention this project exists to avoid.
 *
 * The panel never computes a pose value itself: it renders what `resolvePose`
 * decided and feeds user text back in as overrides.
 */

import type { PoseField, PoseResolution } from '../../exif';
import {
  fieldsInGroup,
  formatFieldValue,
  POSE_FIELD_META,
  REASON_TEXT,
  SOURCE_BADGE,
  SOURCE_DESCRIPTION,
} from '../pose-fields';
import { isInvalidDraft } from '../state';

export interface OverridePanelProps {
  resolution: PoseResolution;
  drafts: Readonly<Partial<Record<PoseField, string>>>;
  onDraftChange: (field: PoseField, text: string) => void;
  /** Drop the override entirely, handing the field back to EXIF/assumptions. */
  onDraftRevert: (field: PoseField) => void;
  declinationDraft: string;
  onDeclinationChange: (text: string) => void;
  useStandardAssumptions: boolean;
  onAssumptionsToggle: (enabled: boolean) => void;
}

const GROUP_HEADINGS: Record<'observer' | 'camera', string> = {
  observer: 'Where the camera stood',
  camera: 'Where it pointed, and how wide',
};

function FieldRow({
  field,
  resolution,
  draft,
  onDraftChange,
  onDraftRevert,
}: {
  field: PoseField;
  resolution: PoseResolution;
  draft: string | undefined;
  onDraftChange: (field: PoseField, text: string) => void;
  onDraftRevert: (field: PoseField) => void;
}): JSX.Element {
  const meta = POSE_FIELD_META[field];
  const state = resolution.fields[field];
  const inputId = `pose-${field}`;
  const stateId = `pose-${field}-state`;
  const invalid = isInvalidDraft(draft);

  const resolvedValue = state.status === 'resolved' ? state.value : undefined;
  // The draft wins the display whenever the user has touched the box, including
  // when they have emptied it — an empty box is still a box being edited.
  // "Revert" removes the draft outright and hands the field back to EXIF.
  const resolvedText = formatFieldValue(resolvedValue, meta.decimals);
  const shown = draft ?? resolvedText;
  // Visible only while the box is empty. An emptied override therefore still
  // shows, greyed out, the value actually in force — so an empty box never
  // reads as "this app has no value for this field" when it does.
  const placeholder = state.status === 'needs-manual' ? 'unknown' : resolvedText;

  const badge =
    state.status === 'resolved'
      ? { text: SOURCE_BADGE[state.source], title: SOURCE_DESCRIPTION[state.source] }
      : { text: '⚠ needs input', title: REASON_TEXT[state.reason] };

  const stateText = invalid
    ? 'That is not a number, so it is being ignored — the value below is what will be used.'
    : state.status === 'resolved'
      ? SOURCE_DESCRIPTION[state.source]
      : REASON_TEXT[state.reason];

  return (
    <div
      className="field"
      data-testid={`field-${field}`}
      data-status={state.status}
      data-source={state.status === 'resolved' ? state.source : ''}
      data-reason={state.status === 'needs-manual' ? state.reason : ''}
      data-value={resolvedValue === undefined ? '' : String(resolvedValue)}
    >
      <label className="field__label" htmlFor={inputId}>
        {meta.label} <span className="field__unit">{meta.unit}</span>
      </label>
      <div className="field__control">
        <input
          id={inputId}
          data-testid={`input-${field}`}
          className={`field__input${invalid ? ' field__input--invalid' : ''}`}
          type="number"
          inputMode="decimal"
          step={meta.step}
          value={shown}
          placeholder={placeholder}
          aria-describedby={stateId}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            onDraftChange(field, event.target.value);
          }}
        />
        <span
          className={`badge badge--${state.status === 'resolved' ? state.source : 'missing'}`}
          data-testid={`badge-${field}`}
          title={badge.title}
        >
          {badge.text}
        </span>
        {draft !== undefined && (
          <button
            type="button"
            className="link-button"
            data-testid={`revert-${field}`}
            onClick={() => {
              onDraftRevert(field);
            }}
          >
            Revert
          </button>
        )}
      </div>
      <p className="field__state" id={stateId} data-testid={`state-${field}`}>
        {stateText} <span className="field__hint">{meta.hint}</span>
      </p>
    </div>
  );
}

export function OverridePanel(props: OverridePanelProps): JSX.Element {
  const { resolution, drafts, onDraftChange, onDraftRevert } = props;
  const missingCount = resolution.missing.length;

  return (
    <section className="panel" aria-labelledby="overrides-heading">
      <h2 id="overrides-heading">3. Pose fields</h2>
      <p
        className={`status ${missingCount === 0 ? 'status--ok' : 'status--warn'}`}
        role="status"
        data-testid="missing-summary"
        data-missing-count={missingCount}
      >
        {missingCount === 0
          ? 'All nine pose fields are resolved.'
          : `${String(missingCount)} of 9 fields need manual input.`}
      </p>

      <div className="options">
        <div className="options__row">
          <label className="options__label" htmlFor="declination">
            Magnetic declination <span className="field__unit">° east positive</span>
          </label>
          <input
            id="declination"
            data-testid="input-declination"
            className="field__input"
            type="number"
            inputMode="decimal"
            step={0.1}
            value={props.declinationDraft}
            placeholder="not supplied"
            aria-describedby="declination-help"
            onChange={(event) => {
              props.onDeclinationChange(event.target.value);
            }}
          />
          <p className="field__state" id="declination-help">
            Only needed when the photo records a MAGNETIC bearing. This app ships no geomagnetic
            model, so without this number a magnetic reading stays unusable rather than being passed
            off as true north.
          </p>
        </div>

        <div className="options__row">
          <label className="options__checkbox" htmlFor="assumptions">
            <input
              id="assumptions"
              data-testid="input-assumptions"
              type="checkbox"
              checked={props.useStandardAssumptions}
              aria-describedby="assumptions-help"
              onChange={(event) => {
                props.onAssumptionsToggle(event.target.checked);
              }}
            />
            Apply standard assumptions
          </label>
          <p className="field__state" id="assumptions-help">
            Eye height 1.6 m, pitch 0°, roll 0° — a handheld photo held level. Off by default, and
            anything it supplies is badged <em>Assumed</em> so it never passes for a measurement.
          </p>
        </div>
      </div>

      {(['observer', 'camera'] as const).map((group) => (
        <fieldset className="field-group" key={group}>
          <legend>{GROUP_HEADINGS[group]}</legend>
          {fieldsInGroup(group).map((field) => (
            <FieldRow
              key={field}
              field={field}
              resolution={resolution}
              draft={drafts[field]}
              onDraftChange={onDraftChange}
              onDraftRevert={onDraftRevert}
            />
          ))}
        </fieldset>
      ))}
    </section>
  );
}
