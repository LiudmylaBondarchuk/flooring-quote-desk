const PG = 'Record failure';

return $input.all().map((item, i) => {
  const j = item.json || {};
  const fromErrorTrigger = !!j.execution || !!j.workflow;

  const message = fromErrorTrigger
    ? (j.execution?.error?.message || j.execution?.lastNodeExecuted || 'workflow failed')
    : (j._error
       || (typeof j.error === 'string' ? j.error : j.error?.message)
       || j.error?.description
       || 'handled failure');

  return {
    json: {
      source: fromErrorTrigger ? 'error_trigger' : 'router_lane',
      workflow_name: j.workflow?.name || null,
      workflow_id: j.workflow?.id || null,
      execution_id: j.execution?.id ? String(j.execution.id) : null,
      node_name: j.execution?.lastNodeExecuted || j._node || null,
      message: String(message).slice(0, 2000),
      gmail_message_id: j.gmail_message_id || null,
      payload: j,
    },
    pairedItem: { item: i },
  };
});
