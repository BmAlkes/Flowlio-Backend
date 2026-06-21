-- Fix existing clients with lead-style status values
UPDATE clients SET status = 'Active'
WHERE type = 'client'
  AND status NOT IN ('Active', 'Onboarding', 'On Hold', 'Inactive', 'Completed', 'Churned');
