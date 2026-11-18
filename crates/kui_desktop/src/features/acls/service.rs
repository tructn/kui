use super::model::AclBinding;
use crate::error::{Error, Result};
use kui_kafka::KafkaClients;
use kui_kafka::acl_admin;
use kui_kafka::acls::validate;
use kui_kafka::connection::rejection;

/// Most ACLs one create or delete request may carry. The dialog sends one per
/// chosen operation, so a larger request didn't come from the UI.
const MAX_PER_REQUEST: usize = 100;

/// Every ACL, ordered by resource type, resource, then principal.
pub fn list(clients: &KafkaClients) -> Result<Vec<AclBinding>> {
    let mut acls = acl_admin::describe(&clients.admin).map_err(|e| connection_error(clients, e))?;
    acls.sort();
    Ok(acls)
}

pub fn create(clients: &KafkaClients, acls: &[AclBinding]) -> Result<()> {
    check_batch(acls)?;
    for acl in acls {
        validate(acl)?;
    }
    Ok(acl_admin::create(&clients.admin, acls).map_err(|e| connection_error(clients, e))?)
}

/// Deletes exactly these ACLs and returns how many Kafka removed.
pub fn delete(clients: &KafkaClients, acls: &[AclBinding]) -> Result<usize> {
    check_batch(acls)?;
    let deleted = acl_admin::delete(&clients.admin, acls).map_err(|e| connection_error(clients, e))?;
    if deleted == 0 {
        return Err(Error::msg("No matching ACL was found. It may have been deleted already."));
    }
    Ok(deleted)
}

fn check_batch(acls: &[AclBinding]) -> Result<()> {
    match acls.len() {
        0 => Err(Error::msg("No ACLs given")),
        n if n > MAX_PER_REQUEST => Err(Error::msg(format!("At most {MAX_PER_REQUEST} ACLs can be changed at once"))),
        _ => Ok(()),
    }
}

fn connection_error(clients: &KafkaClients, e: kui_kafka::Error) -> kui_kafka::Error {
    rejection(&clients.metadata).unwrap_or(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kui_kafka::acls::{Operation, PatternType, Permission, ResourceType};

    fn acl() -> AclBinding {
        AclBinding {
            resource_type: ResourceType::Topic,
            resource_name: "orders".into(),
            pattern_type: PatternType::Literal,
            principal: "User:alice".into(),
            host: "*".into(),
            operation: Operation::Read,
            permission: Permission::Allow,
        }
    }

    #[test]
    fn batches_must_be_non_empty_and_bounded() {
        assert!(check_batch(&[]).is_err());
        assert!(check_batch(&[acl()]).is_ok());
        assert!(check_batch(&vec![acl(); MAX_PER_REQUEST]).is_ok());
        assert!(check_batch(&vec![acl(); MAX_PER_REQUEST + 1]).is_err());
    }
}
