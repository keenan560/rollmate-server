-- Subscriptions — tracks premium entitlement per user.
-- Populated by RevenueCat webhooks once the purchase flow is wired up;
-- until then this table stays empty and everyone reads as unsubscribed.

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    provider text DEFAULT 'revenuecat'::text NOT NULL,
    product_id text,
    status text DEFAULT 'active'::text NOT NULL,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT subscriptions_status_check CHECK (
        status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'in_grace_period'::text])
    )
);

ALTER TABLE public.subscriptions OWNER TO postgres;

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);
CREATE INDEX idx_subscriptions_user_status ON public.subscriptions USING btree (user_id, status);
