import Service from '#models/service'

export type ServiceSlim = Pick<
  Service,
  | 'id'
  | 'service_name'
  | 'installed'
  | 'installation_status'
  | 'ui_location'
  | 'friendly_name'
  | 'description'
  | 'icon'
  | 'powered_by'
  | 'display_order'
  | 'container_image'
  | 'available_update_version'
  | 'category'
  | 'is_custom'
  | 'is_user_modified'
  | 'custom_url'
  | 'auto_update_enabled'
  | 'is_link_tile'
  | 'link_color'
> & { status?: string }
