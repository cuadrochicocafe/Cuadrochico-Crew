import { z } from 'zod';

/** Cantidades de dinero siempre en centavos enteros para evitar errores de punto flotante. */
const cents = z.number().int().nonnegative();
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'usa minúsculas, números y guiones');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora HH:MM');

// ---------- Menú

export const ModifierOptionSchema = z.object({
  id,
  label: z.string().min(1),
  priceCents: cents.default(0),
});

/** Grupo de opciones de una sola elección (p. ej. tipo de leche). La primera opción es la predeterminada. */
export const ModifierGroupSchema = z.object({
  id,
  name: z.string().min(1),
  options: z.array(ModifierOptionSchema).min(1),
});

export const VariantSchema = z.object({
  id,
  label: z.string().min(1),
  priceCents: cents,
  /** Grupos extra que solo aplican a esta variante (p. ej. tipo de leche solo si el cold brew es latte). */
  modifierGroupIds: z.array(id).default([]),
});

export const MenuItemSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().default(''),
  categoryId: id,
  image: z.string().nullable().default(null),
  variants: z.array(VariantSchema).min(1),
  modifierGroupIds: z.array(id).default([]),
  available: z.boolean().default(true),
  /** Para bebidas de temporada: fechas (inclusive) en las que se pueden pedir. */
  availableFrom: isoDate.optional(),
  availableUntil: isoDate.optional(),
});

export const MenuSchema = z
  .object({
    version: z.number().int().positive(),
    categories: z.array(z.object({ id, name: z.string().min(1) })).min(1),
    modifierGroups: z.array(ModifierGroupSchema).default([]),
    items: z.array(MenuItemSchema).min(1),
  })
  .superRefine((menu, ctx) => {
    const cats = new Set(menu.categories.map((c) => c.id));
    const groups = new Set(menu.modifierGroups.map((g) => g.id));
    const seen = new Set<string>();
    menu.items.forEach((item, i) => {
      if (seen.has(item.id))
        ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `id repetido: ${item.id}` });
      seen.add(item.id);
      if (!cats.has(item.categoryId))
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'categoryId'],
          message: `categoría inexistente: ${item.categoryId}`,
        });
      const used = [...item.modifierGroupIds, ...item.variants.flatMap((v) => v.modifierGroupIds)];
      for (const g of used)
        if (!groups.has(g))
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'modifierGroupIds'],
            message: `grupo inexistente: ${g}`,
          });
      const variantIds = new Set<string>();
      for (const v of item.variants) {
        if (variantIds.has(v.id))
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'variants'],
            message: `variante repetida: ${v.id}`,
          });
        variantIds.add(v.id);
      }
    });
  });

// ---------- Reglas del negocio

const Window = z
  .tuple([hhmm, hhmm])
  .refine(([a, b]) => a < b, 'la hora de apertura debe ser antes del cierre');
const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof Weekday>;

export const DiscountTierSchema = z.object({
  minDrinks: z.number().int().positive(),
  percent: z.number().min(0).max(100),
});

/** Horas mínimas de anticipación según el tamaño del pedido: aplica el nivel más alto alcanzado. */
export const LeadTimeTierSchema = z.object({
  minDrinks: z.number().int().positive(),
  hours: z.number().int().nonnegative(),
});

/** Tope técnico anti-abuso, no regla de negocio: pedidos más grandes se organizan por WhatsApp. */
export const MAX_DRINKS_PER_ORDER = 1000;

export const SettingsSchema = z
  .object({
    businessName: z.string(),
    timezone: z.string(),
    minDrinks: z.number().int().positive(),
    leadTimeTiers: z.array(LeadTimeTierSchema).min(1),
    maxDaysAhead: z.number().int().positive(),
    slotMinutes: z.number().int().positive(),
    /** Límite de producción; `null` = sin límite. Se conserva el código por si se necesita después. */
    capacity: z
      .object({
        drinksPerSlot: z.number().int().positive(),
        drinksPerDay: z.number().int().positive(),
      })
      .nullable()
      .default(null),
    /** Ventanas de entrega por día de la semana. La última entrega empieza `slotMinutes` antes del cierre. */
    hours: z.record(Weekday, z.array(Window)),
    closedDates: z.array(isoDate).default([]),
    discountTiers: z.array(DiscountTierSchema),
    /** Porcentaje del anticipo cuando el cliente elige `paymentPlan: 'deposit'`. */
    depositPercent: z.number().min(0).max(100),
    /** Se puede cancelar hasta estas horas antes de la entrega. */
    cancellationHours: z.number().int().nonnegative(),
    /** Horas que un pedido sin pagar aparta su lugar antes de vencer. */
    unpaidHoldHours: z.number().positive(),
    fulfillment: z.object({
      pickup: z.object({ enabled: z.boolean(), address: z.string(), mapsUrl: z.string() }),
      delivery: z.object({
        enabled: z.boolean(),
        feeCents: cents,
        minDrinks: z.number().int().positive(),
        note: z.string(),
      }),
    }),
    payments: z.object({
      transfer: z.object({
        enabled: z.boolean(),
        bank: z.string(),
        beneficiary: z.string(),
        clabe: z.string(),
      }),
      mercadopago: z.object({ enabled: z.boolean() }),
    }),
    contact: z.object({ whatsapp: z.string(), instagram: z.string() }),
  })
  .superRefine((s, ctx) => {
    for (const key of ['discountTiers', 'leadTimeTiers'] as const) {
      const tiers = s[key];
      for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1];
        const cur = tiers[i];
        if (prev && cur && cur.minDrinks <= prev.minDrinks)
          ctx.addIssue({
            code: 'custom',
            path: [key, i],
            message: 'los niveles deben ir de menor a mayor',
          });
      }
    }
    if (s.leadTimeTiers[0]?.minDrinks !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['leadTimeTiers', 0],
        message: 'el primer nivel debe empezar en 1 bebida',
      });
  });

// ---------- Pedido que envía el cliente

/** Teléfono mexicano: se aceptan espacios, guiones y prefijo +52; se guarda como 10 dígitos. */
export const PhoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s()-]/g, '').replace(/^\+?52/, ''))
  .pipe(z.string().regex(/^\d{10}$/, 'escribe un teléfono de 10 dígitos'));

export const OrderLineInputSchema = z.object({
  itemId: id,
  variantId: id,
  /** groupId -> optionId */
  options: z.record(z.string(), z.string()).default({}),
  qty: z.number().int().positive().max(MAX_DRINKS_PER_ORDER),
});

export const OrderInputSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2, 'escribe tu nombre').max(80),
    phone: PhoneSchema,
    email: z.union([z.email('correo no válido'), z.literal('')]).default(''),
  }),
  fulfillment: z.discriminatedUnion('type', [
    z.object({ type: z.literal('pickup') }),
    z.object({
      type: z.literal('delivery'),
      address: z.string().trim().min(10, 'escribe la dirección completa').max(300),
      references: z.string().trim().max(300).default(''),
    }),
  ]),
  slot: z.object({ date: isoDate, time: hhmm }),
  lines: z.array(OrderLineInputSchema).min(1).max(50),
  paymentMethod: z.enum(['transfer', 'mercadopago']),
  /** El cliente elige: anticipo (`depositPercent`) o liquidar el 100 %. Sin valor por defecto. */
  paymentPlan: z.enum(['deposit', 'full']),
  notes: z.string().trim().max(500).default(''),
  /** Token de Cloudflare Turnstile (anti-bots). Opcional si el servidor no lo exige. */
  captchaToken: z.string().max(4096).optional(),
});

export type Menu = z.infer<typeof MenuSchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type DiscountTier = z.infer<typeof DiscountTierSchema>;
export type LeadTimeTier = z.infer<typeof LeadTimeTierSchema>;
export type OrderLineInput = z.infer<typeof OrderLineInputSchema>;
export type OrderInput = z.infer<typeof OrderInputSchema>;
export type OrderInputRaw = z.input<typeof OrderInputSchema>;
export type PaymentMethod = OrderInput['paymentMethod'];
export type PaymentPlan = OrderInput['paymentPlan'];
