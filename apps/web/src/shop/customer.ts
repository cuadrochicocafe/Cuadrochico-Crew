import { OrderInputSchema } from '@cuadrochico/core';

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
  const customer = OrderInputSchema.shape.customer.safeParse({
    name: d.name,
    phone: d.phone,
    email: d.email,
  });
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
