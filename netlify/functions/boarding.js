/**
 * Netlify Function: /boarding
 *
 * POST JSON body:
 *   { name, email, passenger_type, broken_tooling, desired_gap, notes, beta_ack }
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DEFAULT_FLIGHT_TAG            (default: "ALPHA-FAM-001")
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL
 *   SENDGRID_TEMPLATE_ID_NEW_PASSENGER
 *   SENDGRID_TEMPLATE_ID_ALREADY_ON_MANIFEST
 */

const { createClient } = require('@supabase/supabase-js');
const sgMail = require('@sendgrid/mail');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal HTML-escape to safely embed user strings in HTML responses. */
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Derive first_name from a full name string. Falls back to "there". */
function firstName(name) {
  if (!name || !name.trim()) return 'there';
  return name.trim().split(/\s+/)[0];
}

// ─── HTML response templates ─────────────────────────────────────────────────

function htmlBoardingConfirmed(passengerId, flightTag) {
  return `<h1>Boarding confirmed</h1>
<p><strong>Passenger ID:</strong> ${esc(passengerId)}</p>
<p><strong>Flight tag:</strong> ${esc(flightTag)}</p>
<p>You're on the manifest. Keep an eye on your inbox for next steps.</p>`;
}

function htmlAlreadyOnManifest(passengerId, flightTag) {
  return `<h1>You're already on the manifest</h1>
<p><strong>Passenger ID:</strong> ${esc(passengerId)}</p>
<p><strong>Flight tag:</strong> ${esc(flightTag)}</p>
<p>If you updated details, we've saved the latest version on your record.</p>`;
}

function htmlBoardingUnavailable() {
  return `<h1>Boarding temporarily unavailable</h1>
<p>We couldn't process your request right now. Please try again in a few minutes.</p>
<p>If the problem persists, email <strong>support@thispagedoesnotexist12345.com</strong></p>`;
}

// ─── SendGrid helper ─────────────────────────────────────────────────────────

async function sendEmail({ email, name, passengerId, flightTag, templateId }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !fromEmail || !templateId) {
    console.warn('[boarding] SendGrid env vars missing — skipping email.');
    return;
  }

  sgMail.setApiKey(apiKey);

  await sgMail.send({
    to: email,
    from: fromEmail,
    templateId,
    dynamicTemplateData: {
      first_name: firstName(name),
      passenger_id: passengerId,
      flight_tag: flightTag,
    },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<h1>Bad request</h1><p>Request body must be valid JSON.</p>',
    };
  }

  const {
    name = '',
    email: rawEmail = '',
    passenger_type = '',
    broken_tooling = '',
    desired_gap = '',
    notes = '',
    beta_ack = false,
  } = body;

  // ── Validate required fields ────────────────────────────────────────────────
  const email = rawEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<h1>Invalid request</h1><p>A valid email address is required.</p>',
    };
  }

  // ── Server-controlled flight_tag ────────────────────────────────────────────
  const flight_tag = process.env.DEFAULT_FLIGHT_TAG || 'ALPHA-FAM-001';

  // ── Supabase client ─────────────────────────────────────────────────────────
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── Idempotency: look up existing passenger ─────────────────────────────────
  let existingPassenger = null;
  try {
    const { data, error } = await supabase
      .from('passengers')
      .select('passenger_id, status, flight_tag')
      .eq('flight_tag', flight_tag)
      .ilike('email', email)
      .maybeSingle();

    if (error) throw error;
    existingPassenger = data;
  } catch (err) {
    console.error('[boarding] Supabase lookup error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlBoardingUnavailable(),
    };
  }

  // ── Branch: existing passenger → update ────────────────────────────────────
  if (existingPassenger) {
    try {
      const { error } = await supabase
        .from('passengers')
        .update({
          name: name.trim() || undefined,
          broken_tooling,
          desired_gap,
          notes,
          beta_ack,
          source: '.me boarding portal',
          updated_at: new Date().toISOString(),
        })
        .eq('passenger_id', existingPassenger.passenger_id);

      if (error) throw error;
    } catch (err) {
      console.error('[boarding] Supabase update error:', err);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html' },
        body: htmlBoardingUnavailable(),
      };
    }

    // Send "already on manifest" email (non-blocking)
    try {
      await sendEmail({
        email,
        name,
        passengerId: existingPassenger.passenger_id,
        flightTag: existingPassenger.flight_tag,
        templateId: process.env.SENDGRID_TEMPLATE_ID_ALREADY_ON_MANIFEST,
      });
    } catch (emailErr) {
      console.error('[boarding] SendGrid error (already on manifest):', emailErr);
      // Do not fail the request — email is non-blocking
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlAlreadyOnManifest(existingPassenger.passenger_id, existingPassenger.flight_tag),
    };
  }

  // ── Branch: new passenger → mint ID + insert ────────────────────────────────
  let passengerId;
  try {
    const { data, error } = await supabase.rpc('get_next_passenger_id');
    if (error) throw error;
    passengerId = data;
  } catch (err) {
    console.error('[boarding] RPC get_next_passenger_id error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlBoardingUnavailable(),
    };
  }

  try {
    const { error } = await supabase.from('passengers').insert({
      passenger_id:   passengerId,
      name:           name.trim(),
      email,
      passenger_type,
      broken_tooling,
      desired_gap,
      notes,
      status:         'Invited',
      flight_tag,
      beta_ack,
      source:         '.me boarding portal',
    });

    if (error) throw error;
  } catch (err) {
    console.error('[boarding] Supabase insert error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: htmlBoardingUnavailable(),
    };
  }

  // Send "boarding confirmed" email (non-blocking)
  try {
    await sendEmail({
      email,
      name,
      passengerId,
      flightTag: flight_tag,
      templateId: process.env.SENDGRID_TEMPLATE_ID_NEW_PASSENGER,
    });
  } catch (emailErr) {
    console.error('[boarding] SendGrid error (new passenger):', emailErr);
    // Do not fail the request — email is non-blocking
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: htmlBoardingConfirmed(passengerId, flight_tag),
  };
};
