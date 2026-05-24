import logging

from django.http import JsonResponse

from .lib.errors import HttpError

logger = logging.getLogger(__name__)


class JsonErrorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            return self.get_response(request)
        except HttpError as exc:
            return JsonResponse({"error": exc.message}, status=exc.status)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        except Exception as exc:
            logger.exception("Unhandled request error")
            return JsonResponse({"error": str(exc) or "Unexpected error."}, status=500)
