import { OrderInputSchema, type Settings } from '@cuadrochico/core';
import { useState } from 'preact/hooks';
import { focusSoon } from '../lib';

export interface CustomerDraft {
  name: string;
  phone: string;
  email: string;
  fulfillment: 'pickup' | 'delivery';
  address: string;
  references: string;
  notes: string;
}

export const EMPTY_CUSTOMER: CustomerDraft = {
  name: '',
  phone: '',
  email: '',
  fulfillment: 'pickup',
  address: '',
  references: '',
  notes: '',
};

type Field = 'name' | 'phone' | 'email' | 'address';
export type CustomerErrors = Partial<Record<Field, string>>;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Valida con los mismos esquemas de core que usa el servidor. */
export function validateCustomer(d: CustomerDraft): CustomerErrors {
  const errors: CustomerErrors = {};
  const customer = OrderInputSchema.shape.customer.safeParse({ name: d.name, phone: d.phone, email: d.email });
  if (!customer.success)
    for (const issue of customer.error.issues) {
      const key = issue.path[0] as Field;
      errors[key] ??= capitalize(issue.message);
    }
  if (d.fulfillment === 'delivery') {
    const f = OrderInputSchema.shape.fulfillment.safeParse({
      type: 'delivery',
      address: d.address,
      references: d.references,
    });
    if (!f.success) errors.address = capitalize(f.error.issues[0]?.message ?? 'Revisa la dirección');
  }
  return errors;
}

interface Props {
  settings: Settings;
  draft: CustomerDraft;
  onDraft: (d: CustomerDraft) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function DataStep({ settings, draft, onDraft, onBack, onContinue }: Props) {
  const [errors, setErrors] = useState<CustomerErrors>({});
  const set = (k: keyof CustomerDraft) => (e: Event) =>
    onDraft({ ...draft, [k]: (e.target as HTMLInputElement).value });
  const delivery = settings.fulfillment.delivery;

  const submit = (e: Event) => {
    e.preventDefault();
    const found = validateCustomer(draft);
    setErrors(found);
    const first = (['name', 'phone', 'email', 'address'] as const).find((k) => found[k]);
    if (first) {
      focusSoon(`f-${first}`);
      return;
    }
    onContinue();
  };

  const field = (k: Field, label: string, props: Record<string, unknown>, hint?: string) => (
    <div class="field">
      <label for={`f-${k}`}>{label}</label>
      {hint && (
        <p id={`f-${k}-hint`} class="muted small">
          {hint}
        </p>
      )}
      <input
        id={`f-${k}`}
        value={draft[k]}
        onInput={set(k)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={[hint ? `f-${k}-hint` : '', errors[k] ? `f-${k}-error` : ''].join(' ').trim() || undefined}
        {...props}
      />
      {errors[k] && (
        <p id={`f-${k}-error`} class="field-error">
          {errors[k]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      <p class="muted">Solo pedimos lo necesario para tu pedido: nombre y teléfono. El correo es opcional.</p>
      {field('name', 'Nombre', { autoComplete: 'name', required: true, maxLength: 80 })}
      {field(
        'phone',
        'Teléfono (WhatsApp)',
        { type: 'tel', inputMode: 'tel', autoComplete: 'tel', required: true },
        '10 dígitos, para avisarte sobre tu pedido.',
      )}
      {field('email', 'Correo (opcional)', { type: 'email', autoComplete: 'email' })}

      <fieldset>
        <legend>Entrega</legend>
        {delivery.enabled ? (
          <>
            <label class="choice">
              <input
                type="radio"
                name="fulfillment"
                value="pickup"
                checked={draft.fulfillment === 'pickup'}
                onChange={() => onDraft({ ...draft, fulfillment: 'pickup' })}
              />
              <span>Recoger en {settings.fulfillment.pickup.address}</span>
            </label>
            <label class="choice">
              <input
                type="radio"
                name="fulfillment"
                value="delivery"
                checked={draft.fulfillment === 'delivery'}
                onChange={() => onDraft({ ...draft, fulfillment: 'delivery' })}
              />
              <span>Envío a domicilio</span>
            </label>
            {draft.fulfillment === 'delivery' && (
              <>
                <p class="muted small">{delivery.note}</p>
                {field('address', 'Dirección completa', { autoComplete: 'street-address', maxLength: 300 })}
                <div class="field">
                  <label for="f-references">Referencias (opcional)</label>
                  <input id="f-references" value={draft.references} onInput={set('references')} maxLength={300} />
                </div>
              </>
            )}
          </>
        ) : (
          <p>
            Recoges tu pedido en <strong>{settings.fulfillment.pickup.address}</strong>.{' '}
            <a href={settings.fulfillment.pickup.mapsUrl} target="_blank" rel="noopener noreferrer">
              Ver en el mapa<span class="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </p>
        )}
      </fieldset>

      <div class="field">
        <label for="f-notes">Notas para el equipo (opcional)</label>
        <textarea id="f-notes" value={draft.notes} onInput={set('notes')} maxLength={500} rows={3} />
      </div>

      <div class="nav">
        <button type="button" class="btn" onClick={onBack}>
          Atrás
        </button>
        <button type="submit" class="btn primary">
          Revisar pedido
        </button>
      </div>
    </form>
  );
}
