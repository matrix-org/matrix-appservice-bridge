export interface ProtocolInstance {
    desc: string;
    icon?: string;
    fields?: Record<string, undefined>;
    network_id: string;
}

export interface ThirdpartyProtocolResponse {
    user_fields: string[];
    location_fields: string[];
    icon: string;
    field_types: {
        [field_type: string]: {
            regexp: string;
            placeholder: string;
        }
    };
    instances: ProtocolInstance[];
}

export interface ThirdpartyLocationResponse {
    alias: string;
    protocol: string;
    fields: Record<string, unknown>;
}

export interface ThirdpartyUserResponse {
    userid: string;
    protocol: string;
    fields: Record<string, unknown>;
}