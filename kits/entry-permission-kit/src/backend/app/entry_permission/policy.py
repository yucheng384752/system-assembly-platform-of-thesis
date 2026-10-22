"""Entry-layer decisions; a downstream endpoint gate may still deny."""

def allows(*, active, readonly, role_name, access, default_roles,
           override=None, role_grant=None):
    if not active or (readonly and access == "write"):
        return False
    if override is not None:
        return override is True
    if role_grant is not None:
        return role_grant is True
    return role_name in default_roles


def builtin_admin(role_name, is_builtin):
    return role_name == "admin" and is_builtin is True


def may_set_overrides(*, actor_admin, target_readonly):
    return actor_admin and not target_readonly


def tenant_header_allowed(values, default_tenant_id):
    """Reject empty, alternate and duplicate headers; never normalize client input."""
    return not values or (len(values) == 1 and values[0] == str(default_tenant_id))


def may_manage_role(*, actor_admin, target_role):
    return actor_admin or target_role not in {"admin", "manager"}
