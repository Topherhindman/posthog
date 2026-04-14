from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from posthog.api.routing import TeamAndOrgViewSetMixin
from posthog.models import PropertyDefinition
from posthog.permissions import TeamMemberStrictManagementPermission

from products.platform_features.backend.models.property_access_control import PropertyAccessControl
from products.platform_features.backend.property_access_control import PropertyAccessLevel


class PropertyAccessControlSerializer(serializers.ModelSerializer):
    """Serializer for individual property access control rules."""

    access_level = serializers.ChoiceField(
        choices=[(e.value, e.value) for e in PropertyAccessLevel],
        help_text="The access level for this rule.",
    )

    class Meta:
        model = PropertyAccessControl
        fields = [
            "id",
            "access_level",
            "organization_member",
            "role",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]


class PropertyAccessControlResponseSerializer(serializers.Serializer):
    """Serializer for the full access control state of a property definition."""

    access_controls = PropertyAccessControlSerializer(
        many=True,
        help_text="List of all access control rules for this property definition.",
    )
    available_access_levels = serializers.ListField(
        child=serializers.CharField(),
        help_text="Available access levels that can be assigned.",
    )
    default_access_level = serializers.CharField(
        help_text="The default access level when no rules match.",
    )


class PropertyAccessControlUpdateSerializer(serializers.Serializer):
    """Serializer for creating or updating a property access control rule."""

    access_level = serializers.ChoiceField(
        choices=[(e.value, e.value) for e in PropertyAccessLevel],
        allow_null=True,
        help_text="The access level to set. Use null to delete an override.",
    )
    organization_member = serializers.UUIDField(
        required=False,
        allow_null=True,
        default=None,
        help_text="The organization member UUID to set an override for.",
    )
    role = serializers.UUIDField(
        required=False,
        allow_null=True,
        default=None,
        help_text="The role UUID to set an override for.",
    )


class PropertyAccessControlViewSet(TeamAndOrgViewSetMixin, GenericViewSet):
    """
    Manages property-level access control rules for property definitions.

    Nested under `/api/projects/{project_id}/property_definitions/{property_definition_id}/property_access_controls/`.
    """

    scope_object = "property_definition"
    serializer_class = PropertyAccessControlSerializer
    permission_classes = [TeamMemberStrictManagementPermission]

    def _get_property_definition(self) -> PropertyDefinition:
        return PropertyDefinition.objects.get(
            id=self.kwargs["property_definition_id"],
            team_id=self.team_id,
        )

    @extend_schema(
        responses={200: PropertyAccessControlResponseSerializer},
        description="Get all property access control rules for a property definition.",
    )
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        prop_def = self._get_property_definition()
        rules = PropertyAccessControl.objects.filter(
            team_id=self.team_id,
            property_definition=prop_def,
        ).select_related("organization_member", "role", "created_by")

        # compute the default level (the rule with null membership and null role)
        default_rule = rules.filter(organization_member__isnull=True, role__isnull=True).first()
        default_level = default_rule.access_level if default_rule else PropertyAccessLevel.READ_WRITE.value

        return Response(
            {
                "access_controls": PropertyAccessControlSerializer(rules, many=True).data,
                "available_access_levels": [e.value for e in PropertyAccessLevel],
                "default_access_level": default_level,
            }
        )

    @extend_schema(
        request=PropertyAccessControlUpdateSerializer,
        responses={200: PropertyAccessControlSerializer},
        description="Create or update a property access control rule. Send access_level=null to delete an override.",
    )
    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        serializer = PropertyAccessControlUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        prop_def = self._get_property_definition()
        access_level = serializer.validated_data["access_level"]
        org_member_id = serializer.validated_data.get("organization_member")
        role_id = serializer.validated_data.get("role")

        # Build the lookup for upsert
        lookup = {
            "team_id": self.team_id,
            "property_definition": prop_def,
            "organization_member_id": org_member_id,
            "role_id": role_id,
        }

        if access_level is None:
            # Delete the override
            deleted, _ = PropertyAccessControl.objects.filter(**lookup).delete()
            if deleted:
                return Response(status=status.HTTP_204_NO_CONTENT)
            return Response(status=status.HTTP_404_NOT_FOUND)

        rule, _created = PropertyAccessControl.objects.update_or_create(
            **lookup,
            defaults={
                "access_level": access_level,
                "created_by": request.user if request.user.is_authenticated else None,
            },
        )

        return Response(
            PropertyAccessControlSerializer(rule).data,
            status=status.HTTP_200_OK,
        )
